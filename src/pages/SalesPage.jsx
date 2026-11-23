import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Edit3,
  Receipt,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import {
  CLOTHING_TYPES,
  formatINR,
  INSTALLMENT_PAYMENT_MODES,
  PAYMENT_MODES,
  todayISO
} from '../shared/constants.js';
import { apiRequest, fetchSalesCached } from '../offline/sync.js';

export default function SalesPage({ user, onToast, refreshKey }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [dueFilter, setDueFilter] = useState('All');

  // Edit sale modal
  const [editSale, setEditSale] = useState(null);
  const [editForm, setEditForm] = useState({
    payment_mode: 'UPI',
    customer_name: '',
    customer_phone: '',
    next_due_date: '',
    notes: ''
  });
  const [editBusy, setEditBusy] = useState(false);

  // Collect EMI Installment modal
  const [installmentSale, setInstallmentSale] = useState(null);
  const [installmentForm, setInstallmentForm] = useState({
    amount: '',
    payment_date: todayISO(),
    payment_mode: 'UPI',
    next_due_date: '',
    notes: ''
  });
  const [installmentBusy, setInstallmentBusy] = useState(false);

  // Delete sale modal
  const [deleteSale, setDeleteSale] = useState(null);
  const [restoreStock, setRestoreStock] = useState(true);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const currency = user?.currency_symbol || '₹';

  const loadSales = async () => {
    setLoading(true);
    try {
      const res = await fetchSalesCached(user.id);
      setSales(res.sales || []);
    } catch (err) {
      onToast(err.message || 'Failed to load sales ledger.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSales();
  }, [user.id, refreshKey]);

  const getSaleAmounts = (s) => {
    const billed = Number((Number(s.selling_price) * Number(s.quantity_sold)).toFixed(2));
    const paid =
      s.amount_paid !== null && s.amount_paid !== undefined ? Number(s.amount_paid) : billed;
    const due =
      s.balance_due !== null && s.balance_due !== undefined
        ? Number(s.balance_due)
        : Number(Math.max(0, billed - paid).toFixed(2));
    return { billed, paid, due };
  };

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (startDate && s.sale_date < startDate) return false;
      if (endDate && s.sale_date > endDate) return false;
      if (typeFilter !== 'All' && s.type !== typeFilter) return false;
      if (paymentFilter !== 'All' && s.payment_mode !== paymentFilter) return false;
      const { due } = getSaleAmounts(s);
      if (dueFilter === 'Pending Due' && due <= 0) return false;
      if (dueFilter === 'Paid' && due > 0) return false;

      if (q) {
        const hay = [s.customer_name, s.customer_phone, s.sku, s.item_name, s.notes]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sales, search, startDate, endDate, typeFilter, paymentFilter, dueFilter]);

  const totals = useMemo(() => {
    return filteredSales.reduce(
      (acc, s) => {
        const { billed, paid, due } = getSaleAmounts(s);
        acc.units += Number(s.quantity_sold) || 0;
        acc.revenue += billed;
        acc.collected += paid;
        acc.pendingDue += due;
        acc.profit += Number(s.profit) || 0;
        return acc;
      },
      { units: 0, revenue: 0, collected: 0, pendingDue: 0, profit: 0 }
    );
  }, [filteredSales]);

  const openEditModal = (sale) => {
    setEditSale(sale);
    setEditForm({
      payment_mode: sale.payment_mode || 'UPI',
      customer_name: sale.customer_name || '',
      customer_phone: sale.customer_phone || '',
      next_due_date: sale.next_due_date || '',
      notes: sale.notes || ''
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editSale) return;
    setEditBusy(true);
    try {
      const res = await apiRequest(`/api/sales/${encodeURIComponent(editSale.id)}`, {
        method: 'PUT',
        body: editForm
      });
      setSales((prev) => prev.map((row) => (row.id === editSale.id ? res.sale : row)));
      setEditSale(null);
      onToast('Sale record updated.', 'success');
    } catch (err) {
      onToast(err.message || 'Could not update sale while offline.', 'error');
    } finally {
      setEditBusy(false);
    }
  };

  const openInstallmentModal = (sale) => {
    const { due } = getSaleAmounts(sale);
    setInstallmentSale(sale);
    setInstallmentForm({
      amount: due > 0 ? String(due) : '',
      payment_date: todayISO(),
      payment_mode: 'UPI',
      next_due_date: sale.next_due_date || '',
      notes: ''
    });
  };

  const handleCollectInstallment = async (e) => {
    e.preventDefault();
    if (!installmentSale) return;
    setInstallmentBusy(true);
    try {
      const res = await apiRequest(
        `/api/sales/${encodeURIComponent(installmentSale.id)}/installments`,
        {
          method: 'POST',
          body: {
            ...installmentForm,
            amount: Number(installmentForm.amount),
            next_due_date: installmentForm.next_due_date || null
          }
        }
      );
      setSales((prev) => prev.map((row) => (row.id === installmentSale.id ? res.sale : row)));
      setInstallmentSale(null);
      onToast('EMI installment recorded.', 'success');
    } catch (err) {
      onToast(err.message || 'Could not record installment.', 'error');
    } finally {
      setInstallmentBusy(false);
    }
  };

  const handleDeleteSale = async () => {
    if (!deleteSale) return;
    setDeleteBusy(true);
    try {
      await apiRequest(
        `/api/sales/${encodeURIComponent(deleteSale.id)}?restoreStock=${restoreStock}`,
        { method: 'DELETE' }
      );
      setSales((prev) => prev.filter((row) => row.id !== deleteSale.id));
      setDeleteSale(null);
      onToast(
        restoreStock
          ? 'Sale deleted and stock quantity restored.'
          : 'Sale deleted without changing stock.',
        'success'
      );
    } catch (err) {
      onToast(err.message || 'Could not delete sale while offline.', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setTypeFilter('All');
    setPaymentFilter('All');
    setDueFilter('All');
  };

  const instDue = installmentSale ? getSaleAmounts(installmentSale).due : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary Strip */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Transactions</div>
          <div className="kpi-value tabular">{filteredSales.length}</div>
          <div className="kpi-foot tabular">{totals.units} unit(s) sold</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Billed Revenue</div>
          <div className="kpi-value tabular">{formatINR(totals.revenue, currency)}</div>
          <div className="kpi-foot tabular">Collected: {formatINR(totals.collected, currency)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pending EMI Due</div>
          <div className="kpi-value tabular" style={{ color: 'var(--amber)' }}>
            {formatINR(totals.pendingDue, currency)}
          </div>
          <div className="kpi-foot">Installments receivable</div>
        </div>
        <div className="kpi-card hero">
          <div className="kpi-label">Net Profit</div>
          <div className="kpi-value tabular">{formatINR(totals.profit, currency)}</div>
          <div className="kpi-foot">After purchase cost</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card">
        <div className="filter-bar">
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search
              size={15}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 36 }}
              type="search"
              placeholder="Search customer, phone, SKU, item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <input
            className="input"
            style={{ width: 'auto' }}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Start date"
          />
          <input
            className="input"
            style={{ width: 'auto' }}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="End date"
          />

          <select
            className="select"
            style={{ width: 'auto', minWidth: 130 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by item type"
          >
            <option value="All">All Types</option>
            {CLOTHING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 136 }}
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            aria-label="Filter by payment mode"
          >
            <option value="All">All Modes</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 136 }}
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value)}
            aria-label="Filter by payment status"
          >
            <option value="All">All Dues</option>
            <option value="Pending Due">Pending EMI Due</option>
            <option value="Paid">Fully Paid</option>
          </select>

          <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20 }}>
            <div className="skeleton" style={{ height: 220 }} />
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Receipt size={24} />
            </div>
            <div style={{ fontWeight: 700 }}>No sales records found</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Completed sales and EMI transactions will appear here.
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Customer</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th>Paid / Due</th>
                  <th>Profit</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((s) => {
                  const { billed, paid, due } = getSaleAmounts(s);
                  return (
                    <tr key={s.id}>
                      <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                        <div>{s.sale_date}</div>
                        <span className="badge badge-neutral">{s.payment_mode}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.item_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {s.sku} · {s.type}
                        </div>
                      </td>
                      <td>
                        <div>{s.customer_name || 'Walk-in'}</div>
                        {s.customer_phone && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }} className="tabular">
                            {s.customer_phone}
                          </div>
                        )}
                      </td>
                      <td className="tabular">{s.quantity_sold}</td>
                      <td className="tabular" style={{ fontWeight: 700 }}>
                        {formatINR(billed, currency)}
                      </td>
                      <td className="tabular">
                        <div style={{ fontSize: 12.5, color: 'var(--emerald)', fontWeight: 600 }}>
                          Paid: {formatINR(paid, currency)}
                        </div>
                        {due > 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>
                            Due: {formatINR(due, currency)}
                            {s.next_due_date ? ` (${s.next_due_date})` : ''}
                          </div>
                        ) : (
                          <span className="badge badge-green">Settled</span>
                        )}
                      </td>
                      <td
                        className="tabular"
                        style={{
                          fontWeight: 700,
                          color: Number(s.profit) >= 0 ? 'var(--emerald)' : 'var(--danger)'
                        }}
                      >
                        {formatINR(s.profit, currency)}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {due > 0 && (
                            <button
                              type="button"
                              className="btn btn-emerald btn-sm"
                              onClick={() => openInstallmentModal(s)}
                            >
                              <CreditCard size={13} />
                              <span>+ EMI</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-icon"
                            onClick={() => openEditModal(s)}
                            aria-label="Edit sale"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-icon"
                            onClick={() => {
                              setDeleteSale(s);
                              setRestoreStock(true);
                            }}
                            aria-label="Delete sale"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Collect EMI Installment Modal */}
      <Modal
        open={Boolean(installmentSale)}
        title={`Collect Installment — ${installmentSale?.item_name || ''}`}
        onClose={() => setInstallmentSale(null)}
        maxWidth={440}
      >
        {installmentSale && (
          <form
            onSubmit={handleCollectInstallment}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div
              style={{
                padding: '10px 13px',
                borderRadius: 11,
                background: 'var(--amber-soft)',
                color: 'var(--amber)',
                fontWeight: 700,
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between'
              }}
              className="tabular"
            >
              <span>Customer: {installmentSale.customer_name || 'Walk-in'}</span>
              <span>Balance Due: {formatINR(instDue, currency)}</span>
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label className="field-label" htmlFor="inst-amount">
                  Amount Received ({currency})
                </label>
                <input
                  id="inst-amount"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={instDue}
                  required
                  value={installmentForm.amount}
                  onChange={(e) =>
                    setInstallmentForm((f) => ({ ...f, amount: e.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="inst-mode">
                  Received Via
                </label>
                <select
                  id="inst-mode"
                  className="select"
                  value={installmentForm.payment_mode}
                  onChange={(e) =>
                    setInstallmentForm((f) => ({ ...f, payment_mode: e.target.value }))
                  }
                >
                  {INSTALLMENT_PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label className="field-label" htmlFor="inst-date">
                  Payment Date
                </label>
                <input
                  id="inst-date"
                  className="input"
                  type="date"
                  required
                  value={installmentForm.payment_date}
                  onChange={(e) =>
                    setInstallmentForm((f) => ({ ...f, payment_date: e.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="inst-next-due">
                  Next Due Date (if balance remains)
                </label>
                <input
                  id="inst-next-due"
                  className="input"
                  type="date"
                  value={installmentForm.next_due_date}
                  onChange={(e) =>
                    setInstallmentForm((f) => ({ ...f, next_due_date: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="inst-notes">
                Note
              </label>
              <input
                id="inst-notes"
                className="input"
                type="text"
                placeholder="e.g. Second installment"
                value={installmentForm.notes}
                onChange={(e) => setInstallmentForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setInstallmentSale(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-emerald" disabled={installmentBusy}>
                <CheckCircle2 size={14} />
                <span>{installmentBusy ? 'Saving...' : 'Record Payment'}</span>
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit Sale Modal */}
      <Modal open={Boolean(editSale)} title="Edit Sale Details" onClose={() => setEditSale(null)}>
        <form
          onSubmit={handleSaveEdit}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div className="form-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="edit-sale-mode">
                Payment Mode
              </label>
              <select
                id="edit-sale-mode"
                className="select"
                value={editForm.payment_mode}
                onChange={(e) => setEditForm((f) => ({ ...f, payment_mode: e.target.value }))}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="edit-sale-due">
                Next Due Date
              </label>
              <input
                id="edit-sale-due"
                className="input"
                type="date"
                value={editForm.next_due_date}
                onChange={(e) => setEditForm((f) => ({ ...f, next_due_date: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="edit-sale-customer">
                Customer Name
              </label>
              <input
                id="edit-sale-customer"
                className="input"
                type="text"
                value={editForm.customer_name}
                onChange={(e) => setEditForm((f) => ({ ...f, customer_name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="edit-sale-phone">
                Customer Phone
              </label>
              <input
                id="edit-sale-phone"
                className="input"
                type="tel"
                value={editForm.customer_phone}
                onChange={(e) => setEditForm((f) => ({ ...f, customer_phone: e.target.value }))}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="edit-sale-notes">
              Notes
            </label>
            <textarea
              id="edit-sale-notes"
              className="textarea"
              value={editForm.notes}
              onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditSale(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={editBusy}>
              {editBusy ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Sale Modal */}
      <Modal
        open={Boolean(deleteSale)}
        title="Delete Sale Record"
        onClose={() => setDeleteSale(null)}
        maxWidth={430}
      >
        <p style={{ marginTop: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Delete this sale of <strong>{deleteSale?.item_name}</strong> (
          <span className="tabular">Qty {deleteSale?.quantity_sold}</span>)?
        </p>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: 18
          }}
        >
          <input
            type="checkbox"
            checked={restoreStock}
            onChange={(e) => setRestoreStock(e.target.checked)}
          />
          <span>Restore {deleteSale?.quantity_sold || 1} unit(s) back to Inventory stock</span>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDeleteSale(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleteBusy}
            onClick={handleDeleteSale}
          >
            {deleteBusy ? 'Deleting...' : 'Delete Sale'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
