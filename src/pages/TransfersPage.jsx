import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Edit3,
  Plus,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { formatINR, INSTALLMENT_PAYMENT_MODES, todayISO } from '../shared/constants.js';
import { apiRequest } from '../offline/sync.js';

const EMPTY_TRANSFER = {
  transfer_date: todayISO(),
  from_account: '',
  to_account: '',
  amount: '',
  payment_mode: 'UPI',
  notes: ''
};

export default function TransfersPage({ user, onToast, refreshKey }) {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState(null);
  const [form, setForm] = useState(EMPTY_TRANSFER);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const currency = user?.currency_symbol || '₹';

  const loadTransfers = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/transfers');
      setTransfers(res.transfers || []);
    } catch (err) {
      onToast(err.message || 'Failed to load money transfers.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransfers();
  }, [user.id, refreshKey]);

  const filteredTransfers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transfers.filter((t) => {
      if (modeFilter !== 'All' && t.payment_mode !== modeFilter) return false;
      if (startDate && t.transfer_date < startDate) return false;
      if (endDate && t.transfer_date > endDate) return false;
      if (q) {
        const hay = [t.from_account, t.to_account, t.payment_mode, t.notes]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transfers, search, modeFilter, startDate, endDate]);

  const totalTransferred = useMemo(() => {
    return Number(
      filteredTransfers.reduce((sum, t) => sum + (Number(t.amount) || 0), 0).toFixed(2)
    );
  }, [filteredTransfers]);

  const openCreateModal = () => {
    setEditingTransfer(null);
    setForm({ ...EMPTY_TRANSFER, transfer_date: todayISO() });
    setModalOpen(true);
  };

  const openEditModal = (t) => {
    setEditingTransfer(t);
    setForm({
      transfer_date: t.transfer_date || todayISO(),
      from_account: t.from_account || '',
      to_account: t.to_account || '',
      amount: String(t.amount ?? ''),
      payment_mode: t.payment_mode || 'UPI',
      notes: t.notes || ''
    });
    setModalOpen(true);
  };

  const handleSaveTransfer = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount)
      };

      if (editingTransfer) {
        const res = await apiRequest(
          `/api/transfers/${encodeURIComponent(editingTransfer.id)}`,
          {
            method: 'PUT',
            body: payload
          }
        );
        setTransfers((prev) =>
          prev.map((row) => (row.id === editingTransfer.id ? res.transfer : row))
        );
        onToast('Transfer updated.', 'success');
      } else {
        const res = await apiRequest('/api/transfers', {
          method: 'POST',
          body: payload
        });
        setTransfers((prev) => [res.transfer, ...prev]);
        onToast('Money transfer recorded.', 'success');
      }

      setModalOpen(false);
      setEditingTransfer(null);
    } catch (err) {
      onToast(err.message || 'Could not save transfer.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTransfer = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await apiRequest(`/api/transfers/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE'
      });
      setTransfers((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      setDeleteTarget(null);
      onToast('Transfer deleted.', 'success');
    } catch (err) {
      onToast(err.message || 'Could not delete transfer.', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setModeFilter('All');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary & Action */}
      <div className="kpi-grid">
        <div className="kpi-card hero">
          <div className="kpi-top">
            <span className="kpi-label">Total Transferred</span>
            <div className="kpi-icon">
              <ArrowLeftRight size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{formatINR(totalTransferred, currency)}</div>
          <div className="kpi-foot tabular">{filteredTransfers.length} transfer(s)</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Record Movement</div>
          <div style={{ marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={openCreateModal}>
              <Plus size={16} />
              <span>New Money Transfer</span>
            </button>
          </div>
          <div className="kpi-foot">From, To, Date, Mode &amp; Notes</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="filter-bar">
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search
              size={15}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 36 }}
              type="search"
              placeholder="Search from, to, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 132 }}
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            aria-label="Filter by payment mode"
          >
            <option value="All">All Modes</option>
            {INSTALLMENT_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

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

          <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Transfers Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20 }}>
            <div className="skeleton" style={{ height: 200 }} />
          </div>
        ) : filteredTransfers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <ArrowLeftRight size={24} />
            </div>
            <div style={{ fontWeight: 700 }}>No money transfers logged yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Track funds moved between cash box, bank account, UPI, or accounts.
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 4 }}
              onClick={openCreateModal}
            >
              <Plus size={15} />
              <span>Add First Transfer</span>
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Mode</th>
                  <th>Notes</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransfers.map((t) => (
                  <tr key={t.id}>
                    <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                      {t.transfer_date}
                    </td>
                    <td style={{ fontWeight: 600 }}>{t.from_account}</td>
                    <td style={{ fontWeight: 600 }}>{t.to_account}</td>
                    <td>
                      <span className="badge badge-neutral">{t.payment_mode}</span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{t.notes || '—'}</td>
                    <td className="tabular" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {formatINR(t.amount, currency)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-icon"
                          onClick={() => openEditModal(t)}
                          aria-label="Edit transfer"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-icon"
                          onClick={() => setDeleteTarget(t)}
                          aria-label="Delete transfer"
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

      {/* Add / Edit Transfer Modal */}
      <Modal
        open={modalOpen}
        title={editingTransfer ? 'Edit Money Transfer' : 'New Money Transfer'}
        onClose={() => {
          setModalOpen(false);
          setEditingTransfer(null);
        }}
        maxWidth={460}
      >
        <form
          onSubmit={handleSaveTransfer}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div className="form-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="tr-from">
                From *
              </label>
              <input
                id="tr-from"
                className="input"
                type="text"
                required
                placeholder="e.g. Shop Cash, SBI Account"
                value={form.from_account}
                onChange={(e) => setForm((f) => ({ ...f, from_account: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="tr-to">
                To *
              </label>
              <input
                id="tr-to"
                className="input"
                type="text"
                required
                placeholder="e.g. HDFC Bank, Owner, Weaver"
                value={form.to_account}
                onChange={(e) => setForm((f) => ({ ...f, to_account: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-grid-3">
            <div className="field">
              <label className="field-label" htmlFor="tr-amount">
                Amount ({currency}) *
              </label>
              <input
                id="tr-amount"
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

            <div className="field">
              <label className="field-label" htmlFor="tr-date">
                Date *
              </label>
              <input
                id="tr-date"
                className="input"
                type="date"
                required
                value={form.transfer_date}
                onChange={(e) => setForm((f) => ({ ...f, transfer_date: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="tr-mode">
                Mode of Payment
              </label>
              <select
                id="tr-mode"
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
          </div>

          <div className="field">
            <label className="field-label" htmlFor="tr-notes">
              Notes
            </label>
            <input
              id="tr-notes"
              className="input"
              type="text"
              placeholder="Optional reference or note"
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
                setEditingTransfer(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editingTransfer ? 'Save Changes' : 'Save Transfer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        title="Delete Transfer"
        onClose={() => setDeleteTarget(null)}
        maxWidth={400}
      >
        <p style={{ marginTop: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Delete transfer of{' '}
          <strong className="tabular">{formatINR(deleteTarget?.amount || 0, currency)}</strong> from{' '}
          <strong>{deleteTarget?.from_account}</strong> to <strong>{deleteTarget?.to_account}</strong>?
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
            onClick={handleDeleteTransfer}
          >
            {deleteBusy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
