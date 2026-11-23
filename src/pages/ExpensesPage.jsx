import React, { useEffect, useMemo, useState } from 'react';
import {
  Edit3,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
  Wallet
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import {
  EXPENSE_CATEGORIES,
  formatINR,
  INSTALLMENT_PAYMENT_MODES,
  todayISO
} from '../shared/constants.js';
import { apiRequest } from '../offline/sync.js';

const EMPTY_EXPENSE_FORM = {
  expense_date: todayISO(),
  category: 'Shop Rent & Maintenance',
  title: '',
  amount: '',
  payment_mode: 'UPI',
  vendor_name: '',
  related_sku: '',
  notes: ''
};

export default function ExpensesPage({ user, onToast, refreshKey }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Add / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState(EMPTY_EXPENSE_FORM);
  const [saving, setSaving] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const currency = user?.currency_symbol || '₹';

  const loadExpenses = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/expenses');
      setExpenses(res.expenses || []);
    } catch (err) {
      onToast(err.message || 'Failed to load expenses.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
  }, [user.id, refreshKey]);

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((exp) => {
      if (categoryFilter !== 'All' && exp.category !== categoryFilter) return false;
      if (startDate && exp.expense_date < startDate) return false;
      if (endDate && exp.expense_date > endDate) return false;
      if (q) {
        const hay = [
          exp.title,
          exp.category,
          exp.vendor_name,
          exp.related_sku,
          exp.payment_mode,
          exp.notes
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [expenses, search, categoryFilter, startDate, endDate]);

  const summary = useMemo(() => {
    let totalSpent = 0;
    let returnRefunds = 0;
    let operatingSpent = 0;

    for (const exp of filteredExpenses) {
      const amt = Number(exp.amount) || 0;
      totalSpent += amt;
      if (exp.category === 'Customer Return Refund') {
        returnRefunds += amt;
      } else {
        operatingSpent += amt;
      }
    }

    return {
      count: filteredExpenses.length,
      totalSpent: Number(totalSpent.toFixed(2)),
      returnRefunds: Number(returnRefunds.toFixed(2)),
      operatingSpent: Number(operatingSpent.toFixed(2))
    };
  }, [filteredExpenses]);

  const openCreateModal = () => {
    setEditingExpense(null);
    setForm({ ...EMPTY_EXPENSE_FORM, expense_date: todayISO() });
    setModalOpen(true);
  };

  const openEditModal = (exp) => {
    setEditingExpense(exp);
    setForm({
      expense_date: exp.expense_date || todayISO(),
      category: exp.category || 'Miscellaneous',
      title: exp.title || '',
      amount: String(exp.amount ?? ''),
      payment_mode: exp.payment_mode || 'UPI',
      vendor_name: exp.vendor_name || '',
      related_sku: exp.related_sku || '',
      notes: exp.notes || ''
    });
    setModalOpen(true);
  };

  const handleSaveExpense = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount)
      };

      if (editingExpense) {
        const res = await apiRequest(`/api/expenses/${encodeURIComponent(editingExpense.id)}`, {
          method: 'PUT',
          body: payload
        });
        setExpenses((prev) =>
          prev.map((row) => (row.id === editingExpense.id ? res.expense : row))
        );
        onToast('Expense updated.', 'success');
      } else {
        const res = await apiRequest('/api/expenses', {
          method: 'POST',
          body: payload
        });
        setExpenses((prev) => [res.expense, ...prev]);
        onToast('Expense added to ledger.', 'success');
      }

      setModalOpen(false);
      setEditingExpense(null);
    } catch (err) {
      onToast(err.message || 'Could not save expense.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await apiRequest(`/api/expenses/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE'
      });
      setExpenses((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      setDeleteTarget(null);
      onToast('Expense deleted.', 'success');
    } catch (err) {
      onToast(err.message || 'Could not delete expense.', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('All');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI Strip */}
      <div className="kpi-grid">
        <div className="kpi-card hero">
          <div className="kpi-top">
            <span className="kpi-label">Total Expenditure</span>
            <div className="kpi-icon">
              <Wallet size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{formatINR(summary.totalSpent, currency)}</div>
          <div className="kpi-foot tabular">{summary.count} logged entry(ies)</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Operating &amp; Shop Expenses</div>
          <div className="kpi-value tabular">{formatINR(summary.operatingSpent, currency)}</div>
          <div className="kpi-foot">Rent, packaging, tailoring, courier &amp; bills</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Return Refunds Paid</div>
          <div className="kpi-value tabular" style={{ color: 'var(--amber)' }}>
            {formatINR(summary.returnRefunds, currency)}
          </div>
          <div className="kpi-foot">Refunds issued on returned items</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Quick Action</div>
          <div style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={openCreateModal}>
              <Plus size={16} />
              <span>Add Expenditure</span>
            </button>
          </div>
          <div className="kpi-foot">Log shop bills or manual return costs</div>
        </div>
      </div>

      {/* Filters */}
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
              placeholder="Search title, vendor, SKU, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 185 }}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by expense category"
          >
            <option value="All">All Categories</option>
            {EXPENSE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <input
            className="input"
            style={{ width: 'auto' }}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="From date"
          />

          <input
            className="input"
            style={{ width: 'auto' }}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="To date"
          />

          <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Expenses Ledger Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20 }}>
            <div className="skeleton" style={{ height: 220 }} />
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <ReceiptText size={24} />
            </div>
            <div style={{ fontWeight: 700 }}>No expenses recorded yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 400 }}>
              Add manual expenditures like shop rent, carry bags, fall/pico tailoring, courier charges,
              or return refund payouts.
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 4 }}
              onClick={openCreateModal}
            >
              <Plus size={15} />
              <span>Add First Expense</span>
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Expense</th>
                  <th>Category</th>
                  <th>Vendor / SKU</th>
                  <th>Mode</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((exp) => (
                  <tr key={exp.id}>
                    <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                      {exp.expense_date}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{exp.title}</div>
                      {exp.notes && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{exp.notes}</div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          exp.category === 'Customer Return Refund' ? 'badge-amber' : 'badge-violet'
                        }`}
                      >
                        {exp.category}
                      </span>
                    </td>
                    <td>
                      <div>{exp.vendor_name || '—'}</div>
                      {exp.related_sku && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          SKU: {exp.related_sku}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral">{exp.payment_mode}</span>
                    </td>
                    <td
                      className="tabular"
                      style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}
                    >
                      {formatINR(exp.amount, currency)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-icon"
                          onClick={() => openEditModal(exp)}
                          aria-label="Edit expense"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-icon"
                          onClick={() => setDeleteTarget(exp)}
                          aria-label="Delete expense"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Expense Modal */}
      <Modal
        open={modalOpen}
        title={editingExpense ? 'Edit Expenditure' : 'Add Manual Expenditure'}
        onClose={() => {
          setModalOpen(false);
          setEditingExpense(null);
        }}
        maxWidth={500}
      >
        <form onSubmit={handleSaveExpense} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="exp-date">
                Date *
              </label>
              <input
                id="exp-date"
                className="input"
                type="date"
                required
                value={form.expense_date}
                onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="exp-category">
                Category *
              </label>
              <select
                id="exp-category"
                className="select"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="exp-title">
                Expense Title / Item *
              </label>
              <input
                id="exp-title"
                className="input"
                type="text"
                required
                placeholder="e.g. Saree bags, Fall & pico, Rent"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="exp-amount">
                Amount ({currency}) *
              </label>
              <input
                id="exp-amount"
                className="input"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-grid-3">
            <div className="field">
              <label className="field-label" htmlFor="exp-mode">
                Payment Mode
              </label>
              <select
                id="exp-mode"
                className="select"
                value={form.payment_mode}
                onChange={(e) => setForm((f) => ({ ...f, payment_mode: e.target.value }))}
              >
                {INSTALLMENT_PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="exp-vendor">
                Vendor / Payee
              </label>
              <input
                id="exp-vendor"
                className="input"
                type="text"
                placeholder="Optional"
                value={form.vendor_name}
                onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="exp-sku">
                Related SKU
              </label>
              <input
                id="exp-sku"
                className="input"
                type="text"
                placeholder="Optional (e.g. 52-1)"
                value={form.related_sku}
                onChange={(e) => setForm((f) => ({ ...f, related_sku: e.target.value }))}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="exp-notes">
              Details / Notes
            </label>
            <textarea
              id="exp-notes"
              className="textarea"
              placeholder="Add breakdown details, return reason, or bill number..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setModalOpen(false);
                setEditingExpense(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editingExpense ? 'Save Changes' : 'Add Expense'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        title="Delete Expense Entry"
        onClose={() => setDeleteTarget(null)}
        maxWidth={410}
      >
        <p style={{ marginTop: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Delete <strong>{deleteTarget?.title}</strong> (
          <span className="tabular">{formatINR(deleteTarget?.amount || 0, currency)}</span>)?
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleteBusy}
            onClick={handleDeleteExpense}
          >
            {deleteBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
