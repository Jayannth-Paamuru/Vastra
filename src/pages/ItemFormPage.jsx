import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronUp,
  Layers,
  SlidersHorizontal,
  Upload,
  X
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import {
  calculateMarginPercent,
  DRESS_ALPHA_SIZES,
  DRESS_NUMERIC_SIZES,
  formatINR,
  generateSeriesSkus,
  INVENTORY_STATUSES,
  PATTERN_PRESETS,
  PRIMARY_CLOTHING_CATEGORIES,
  SUB_TYPE_PRESETS_BY_CATEGORY,
  todayISO
} from '../shared/constants.js';
import { compressImageFile } from '../offline/image.js';
import { apiRequest, saveInventoryItemOfflineAware } from '../offline/sync.js';

function mapTypeToPrimaryCategory(rawType) {
  if (!rawType) return 'Sarees';
  const low = rawType.toLowerCase();
  if (low.includes('saree')) return 'Sarees';
  if (
    low.includes('dress') ||
    low.includes('kurti') ||
    low.includes('lehenga') ||
    low.includes('gown') ||
    low.includes('co-ord') ||
    low.includes('sharara') ||
    low.includes('gharara') ||
    low.includes('salwar')
  ) {
    return 'Dresses';
  }
  return 'Others';
}

export default function ItemFormPage({
  user,
  mode = 'create',
  itemId,
  initialDraft,
  onClearDraft,
  navigate,
  onToast,
  onSyncStateChange
}) {
  const isEdit = mode === 'edit' && Boolean(itemId);
  const galleryInputRef = useRef(null);
  const cameraCaptureInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [form, setForm] = useState({
    sku: '',
    clothingCategory: 'Sarees',
    type: 'Sarees',
    quantity: 1,
    purchase_cost: '',
    selling_price: '',
    purchase_date: todayISO(),
    status: 'In Stock',
    enableSeries: false,
    seriesCountInput: '4',
    item_name: '',
    sub_type: '',
    color: '',
    pattern: '',
    fabric: '',
    sizeType: 'alpha',
    size: 'Free Size',
    supplier_name: '',
    notes: ''
  });

  // Tracks which generated series SKUs are checked (defaults to all selected)
  const [selectedSeriesSkus, setSelectedSeriesSkus] = useState([]);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [thumbnails, setThumbnails] = useState([]);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(isEdit);
  const [error, setError] = useState('');

  const [webcamOpen, setWebcamOpen] = useState(false);
  const [webcamError, setWebcamError] = useState('');

  const currency = user?.currency_symbol || '₹';

  const parsedSeriesCount = useMemo(() => {
    const num = parseInt(form.seriesCountInput, 10);
    if (Number.isNaN(num)) return 2;
    return Math.max(2, Math.min(40, num));
  }, [form.seriesCountInput]);

  const allSeriesSkus = useMemo(() => {
    if (!form.enableSeries || isEdit) return [];
    return generateSeriesSkus(form.sku, parsedSeriesCount);
  }, [form.enableSeries, isEdit, form.sku, parsedSeriesCount]);

  // Keep selectedSeriesSkus in sync whenever the generated series list changes
  useEffect(() => {
    if (!form.enableSeries || isEdit) {
      setSelectedSeriesSkus([]);
      return;
    }
    setSelectedSeriesSkus(allSeriesSkus);
  }, [allSeriesSkus, form.enableSeries, isEdit]);

  const activeSeriesSkus = useMemo(() => {
    if (!form.enableSeries || isEdit) return [];
    const checkedSet = new Set(selectedSeriesSkus);
    return allSeriesSkus.filter((sku) => checkedSet.has(sku));
  }, [form.enableSeries, isEdit, allSeriesSkus, selectedSeriesSkus]);

  const toggleSeriesSku = (sku) => {
    setSelectedSeriesSkus((prev) =>
      prev.includes(sku) ? prev.filter((item) => item !== sku) : [...prev, sku]
    );
  };

  const stopWebcamStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopWebcamStream();
  }, []);

  useEffect(() => {
    if (form.clothingCategory === 'Dresses') {
      setAdvancedOpen(true);
    }
  }, [form.clothingCategory]);

  useEffect(() => {
    if (isEdit) {
      setLoadingExisting(true);
      apiRequest(`/api/inventory/${encodeURIComponent(itemId)}`)
        .then((res) => {
          const item = res.item;
          const cat = mapTypeToPrimaryCategory(item.type);
          const isNumSize = DRESS_NUMERIC_SIZES.includes(item.size);
          setForm((prev) => ({
            ...prev,
            sku: item.sku || '',
            clothingCategory: cat,
            type: item.type || cat,
            quantity: Number(item.quantity ?? 1),
            purchase_cost: String(item.purchase_cost ?? ''),
            selling_price: String(item.selling_price ?? ''),
            purchase_date: item.purchase_date || todayISO(),
            status: item.status || 'In Stock',
            enableSeries: false,
            seriesCountInput: '4',
            item_name: item.item_name || '',
            sub_type: item.sub_type || '',
            color: item.color || '',
            pattern: item.pattern || '',
            fabric: item.fabric || '',
            sizeType: isNumSize ? 'numeric' : 'alpha',
            size: item.size || (cat === 'Dresses' ? 'M' : 'Free Size'),
            supplier_name: item.supplier_name || '',
            notes: item.notes || ''
          }));
          const loadedPhotos = Array.isArray(item.photos)
            ? item.photos
            : item.thumbnail_data_url
              ? [item.thumbnail_data_url]
              : [];
          setPhotos(loadedPhotos);
          setThumbnails(
            loadedPhotos.map((p, i) =>
              i === 0 && item.thumbnail_data_url ? item.thumbnail_data_url : p
            )
          );
        })
        .catch((err) => {
          setError(err.message || 'Unable to load inventory item.');
        })
        .finally(() => {
          setLoadingExisting(false);
        });
    } else if (initialDraft) {
      const cat = mapTypeToPrimaryCategory(initialDraft.type);
      setForm((prev) => ({
        ...prev,
        sku: initialDraft.sku ? `${initialDraft.sku}-COPY` : '',
        clothingCategory: cat,
        type: initialDraft.type || cat,
        quantity: Number(initialDraft.quantity ?? 1),
        purchase_cost: String(initialDraft.purchase_cost ?? ''),
        selling_price: String(initialDraft.selling_price ?? ''),
        purchase_date: todayISO(),
        status: 'In Stock',
        enableSeries: false,
        seriesCountInput: '4',
        item_name: initialDraft.item_name || '',
        sub_type: initialDraft.sub_type || '',
        color: initialDraft.color || '',
        pattern: initialDraft.pattern || '',
        fabric: initialDraft.fabric || '',
        sizeType: DRESS_NUMERIC_SIZES.includes(initialDraft.size) ? 'numeric' : 'alpha',
        size: initialDraft.size || 'Free Size',
        supplier_name: initialDraft.supplier_name || '',
        notes: initialDraft.notes || ''
      }));
      if (initialDraft.thumbnail_data_url) {
        setPhotos([initialDraft.thumbnail_data_url]);
        setThumbnails([initialDraft.thumbnail_data_url]);
      }
      onClearDraft?.();
    }
  }, [isEdit, itemId, initialDraft, onClearDraft]);

  const handleCategoryChange = (nextCat) => {
    const nextSize = nextCat === 'Dresses' ? 'M' : 'Free Size';
    setForm((f) => ({
      ...f,
      clothingCategory: nextCat,
      type: nextCat,
      sub_type: '',
      size: nextSize
    }));
  };

  const handleSizeTypeChange = (nextSizeType) => {
    const nextSize = nextSizeType === 'numeric' ? '38' : 'M';
    setForm((f) => ({
      ...f,
      sizeType: nextSizeType,
      size: nextSize
    }));
  };

  const addCompressedFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const remainingSlots = 3 - photos.length;
    if (remainingSlots <= 0) {
      setError('Maximum of 3 compressed photos allowed per item.');
      return;
    }

    setError('');
    setCompressing(true);
    try {
      const batch = files.slice(0, remainingSlots);
      const nextFull = [...photos];
      const nextThumbs = [...thumbnails];

      for (const file of batch) {
        const compressed = await compressImageFile(file);
        nextFull.push(compressed.fullDataUrl);
        nextThumbs.push(compressed.thumbnailDataUrl);
      }

      setPhotos(nextFull);
      setThumbnails(nextThumbs);
    } catch (err) {
      setError(err.message || 'Failed to compress selected image.');
    } finally {
      setCompressing(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
      if (cameraCaptureInputRef.current) cameraCaptureInputRef.current.value = '';
    }
  };

  const openCameraCapture = async () => {
    setError('');
    if (photos.length >= 3) {
      setError('Maximum of 3 compressed photos allowed per item.');
      return;
    }

    const isMobileTouch =
      typeof navigator !== 'undefined' &&
      (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1);

    if (isMobileTouch && cameraCaptureInputRef.current) {
      cameraCaptureInputRef.current.click();
      return;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      setWebcamError('');
      setWebcamOpen(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        stopWebcamStream();
        setWebcamError(
          'Camera permission denied or no webcam detected. You can still pick a photo from your device.'
        );
      }
    } else if (cameraCaptureInputRef.current) {
      cameraCaptureInputRef.current.click();
    }
  };

  const captureWebcamFrame = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      async (blob) => {
        stopWebcamStream();
        setWebcamOpen(false);
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        await addCompressedFiles([file]);
      },
      'image/jpeg',
      0.88
    );
  };

  const closeWebcamModal = () => {
    stopWebcamStream();
    setWebcamOpen(false);
  };

  const removePhoto = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setThumbnails((prev) => prev.filter((_, i) => i !== index));
  };

  const unitCost = Number(form.purchase_cost) || 0;
  const unitPrice = Number(form.selling_price) || 0;
  const unitProfit = Number((unitPrice - unitCost).toFixed(2));
  const marginPct = calculateMarginPercent(unitCost, unitPrice);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanSku = form.sku.trim();
    if (!cleanSku) {
      setError('Please enter a custom alphanumeric SKU (e.g., 52 or SAR-108).');
      return;
    }

    if (!isEdit && form.enableSeries && activeSeriesSkus.length === 0) {
      setError('Please select at least one series piece checkbox to add to inventory.');
      setAdvancedOpen(true);
      return;
    }

    setSaving(true);
    try {
      const resolvedName =
        form.item_name.trim() ||
        [form.color.trim(), form.sub_type.trim() || form.type.trim(), cleanSku]
          .filter(Boolean)
          .join(' ')
          .trim() ||
        cleanSku;

      if (!isEdit && form.enableSeries && activeSeriesSkus.length > 0) {
        let queuedCount = 0;
        for (let idx = 0; idx < activeSeriesSkus.length; idx += 1) {
          const pieceSku = activeSeriesSkus[idx];
          const res = await saveInventoryItemOfflineAware(user.id, {
            sku: pieceSku,
            series_code: cleanSku,
            item_name: `${resolvedName} (${pieceSku})`,
            type: form.type,
            sub_type: form.sub_type.trim(),
            color: form.color.trim(),
            pattern: form.pattern.trim(),
            fabric: form.fabric.trim(),
            size: form.clothingCategory === 'Dresses' ? form.size : 'Free Size',
            supplier_name: form.supplier_name.trim(),
            quantity: 1,
            purchase_cost: unitCost,
            selling_price: unitPrice,
            purchase_date: form.purchase_date,
            status: form.status,
            thumbnail_data_url: thumbnails[0] || photos[0] || null,
            photos,
            notes: form.notes.trim()
          });
          if (res.queued) queuedCount += 1;
        }

        onSyncStateChange();
        onToast(
          queuedCount > 0
            ? `Saved ${activeSeriesSkus.length} selected series item(s) offline.`
            : `Created ${activeSeriesSkus.length} selected series item(s) (${activeSeriesSkus.join(', ')}).`,
          'success'
        );
        navigate('/inventory');
        return;
      }

      const payload = {
        sku: cleanSku,
        series_code: '',
        item_name: resolvedName,
        type: form.type,
        sub_type: form.sub_type.trim(),
        color: form.color.trim(),
        pattern: form.pattern.trim(),
        fabric: form.fabric.trim(),
        size: form.clothingCategory === 'Dresses' ? form.size : 'Free Size',
        supplier_name: form.supplier_name.trim(),
        quantity: Number(form.quantity),
        purchase_cost: unitCost,
        selling_price: unitPrice,
        purchase_date: form.purchase_date,
        status: form.status,
        thumbnail_data_url: thumbnails[0] || photos[0] || null,
        photos,
        notes: form.notes.trim()
      };

      if (isEdit) {
        await saveInventoryItemOfflineAware(user.id, payload, { editId: itemId });
        onToast('Inventory item updated.', 'success');
      } else {
        const res = await saveInventoryItemOfflineAware(user.id, payload);
        onSyncStateChange();
        onToast(
          res.queued
            ? 'Item saved offline — will sync automatically when back online.'
            : 'Item added to boutique inventory.',
          'success'
        );
      }

      navigate('/inventory');
    } catch (err) {
      setError(err.message || 'Failed to save inventory item.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingExisting) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 340 }} />
      </div>
    );
  }

  const subTypeSuggestions = SUB_TYPE_PRESETS_BY_CATEGORY[form.clothingCategory] || [];
  const activeSizeList = form.sizeType === 'numeric' ? DRESS_NUMERIC_SIZES : DRESS_ALPHA_SIZES;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/inventory')}
        >
          <ArrowLeft size={15} />
          <span>Back to Inventory</span>
        </button>
      </div>

      <form
        className="card"
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div>
          <h2 className="card-title" style={{ fontSize: 19 }}>
            {isEdit ? 'Edit Boutique Item' : 'Add New Boutique Item'}
          </h2>
          <p className="card-subtitle">
            Enter your custom SKU, select Sarees, Dresses, or Others, and optionally choose specific series pieces in stock.
          </p>
        </div>

        {error && (
          <div className="alert-banner alert-danger" role="alert">
            <span>{error}</span>
          </div>
        )}

        {/* SKU & Clothing Type */}
        <div className="form-grid-2">
          <div className="field">
            <label className="field-label" htmlFor="item-sku">
              SKU Number (Alphanumeric) *
            </label>
            <input
              id="item-sku"
              className="input"
              type="text"
              required
              placeholder="e.g. 52, SAR-108, DRS-A12"
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="item-category">
              Clothing Type *
            </label>
            <select
              id="item-category"
              className="select"
              value={form.clothingCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              {PRIMARY_CLOTHING_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Multi-Piece Series Toggle & Free Backspace Count Input */}
        {!isEdit && (
          <div className="collapsible-panel">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 13.5
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Layers size={16} color="var(--accent)" />
                <span>Create Numbered Piece Series (e.g., SKU 52 → 52-1, 52-2, 52-3, 52-4)</span>
              </span>
              <input
                type="checkbox"
                checked={form.enableSeries}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((f) => ({
                    ...f,
                    enableSeries: checked
                  }));
                }}
              />
            </label>

            {form.enableSeries && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-grid-2">
                  <div className="field">
                    <label className="field-label" htmlFor="series-count">
                      Number of Pieces in Series
                    </label>
                    <input
                      id="series-count"
                      className="input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="e.g. 4"
                      value={form.seriesCountInput}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, '');
                        setForm((f) => ({ ...f, seriesCountInput: raw }));
                      }}
                      onBlur={() => {
                        setForm((f) => ({
                          ...f,
                          seriesCountInput: String(parsedSeriesCount)
                        }));
                      }}
                    />
                    <span className="field-hint">
                      All {activeSeriesSkus.length} checked piece(s) will be created. Uncheck any sold-out pieces inside Advanced Options.
                    </span>
                  </div>

                  <div className="field">
                    <span className="field-label">Selected Pieces ({activeSeriesSkus.length})</span>
                    <div
                      style={{
                        padding: '9px 12px',
                        borderRadius: 10,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: 12.5,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--accent)',
                        minHeight: 40,
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      {activeSeriesSkus.length > 0
                        ? activeSeriesSkus.join(', ')
                        : 'No pieces selected'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pricing, Quantity, Status & Purchase Date */}
        <div className="form-grid-3">
          <div className="field">
            <label className="field-label" htmlFor="item-cost">
              Purchase Cost ({currency}) *
            </label>
            <input
              id="item-cost"
              className="input"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="0.00"
              value={form.purchase_cost}
              onChange={(e) => setForm((f) => ({ ...f, purchase_cost: e.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="item-price">
              Marked Price ({currency}) *
            </label>
            <input
              id="item-price"
              className="input"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="0.00"
              value={form.selling_price}
              onChange={(e) => setForm((f) => ({ ...f, selling_price: e.target.value }))}
            />
          </div>

          {!form.enableSeries && (
            <div className="field">
              <label className="field-label" htmlFor="item-qty">
                Stock Quantity *
              </label>
              <input
                id="item-qty"
                className="input"
                type="number"
                min="0"
                required
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </div>
          )}
        </div>

        <div className="form-grid-2">
          <div className="field">
            <label className="field-label" htmlFor="item-status">
              Status
            </label>
            <select
              id="item-status"
              className="select"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              {INVENTORY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="item-purchase-date">
              Purchase Date *
            </label>
            <input
              id="item-purchase-date"
              className="input"
              type="date"
              required
              value={form.purchase_date}
              onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
            />
          </div>
        </div>

        {/* Live Profit Margin Preview */}
        <div
          style={{
            padding: '11px 14px',
            borderRadius: 12,
            background: unitProfit >= 0 ? 'var(--emerald-soft)' : 'var(--danger-soft)',
            color: unitProfit >= 0 ? 'var(--emerald)' : 'var(--danger)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 13,
            fontWeight: 700
          }}
          className="tabular"
        >
          <span>Est. Profit / Piece: {formatINR(unitProfit, currency)}</span>
          <span>Margin: {marginPct}%</span>
        </div>

        {/* Collapsible Advanced Options */}
        <div className="collapsible-panel">
          <button
            type="button"
            className="collapsible-header"
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}
            >
              <SlidersHorizontal size={16} color="var(--accent)" />
              <span>
                Advanced Options ({form.clothingCategory} Details
                {form.enableSeries && !isEdit ? ` · ${allSeriesSkus.length} Series Pieces` : ''}
                {form.clothingCategory === 'Dresses' ? ' · Size Selector' : ''})
              </span>
            </span>
            {advancedOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {advancedOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Series Pieces Checkboxes (Only shown when Series is enabled) */}
              {!isEdit && form.enableSeries && allSeriesSkus.length > 0 && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap'
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      Select Series Pieces Currently In Stock
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedSeriesSkus(allSeriesSkus)}
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedSeriesSkus([])}
                      >
                        Uncheck All
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                    {allSeriesSkus.map((pieceSku) => {
                      const checked = selectedSeriesSkus.includes(pieceSku);
                      return (
                        <label
                          key={pieceSku}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 11px',
                            borderRadius: 9,
                            border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
                            background: checked ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                            color: checked ? 'var(--accent)' : 'var(--text-secondary)',
                            fontSize: 13,
                            fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSeriesSku(pieceSku)}
                          />
                          <span>{pieceSku}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label" htmlFor="item-name">
                    Item Name (Optional)
                  </label>
                  <input
                    id="item-name"
                    className="input"
                    type="text"
                    placeholder={
                      form.clothingCategory === 'Sarees'
                        ? 'e.g. Kanjeevaram Tissue Saree'
                        : form.clothingCategory === 'Dresses'
                          ? 'e.g. Embroidered Anarkali Suit'
                          : 'e.g. Designer Blouse / Dupatta'
                    }
                    value={form.item_name}
                    onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="item-subtype">
                    Sub-Type ({form.clothingCategory})
                  </label>
                  <input
                    id="item-subtype"
                    className="input"
                    list="subtype-datalist"
                    type="text"
                    placeholder="Select or type sub-type"
                    value={form.sub_type}
                    onChange={(e) => setForm((f) => ({ ...f, sub_type: e.target.value }))}
                  />
                  <datalist id="subtype-datalist">
                    {subTypeSuggestions.map((st) => (
                      <option key={st} value={st} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="form-grid-3">
                <div className="field">
                  <label className="field-label" htmlFor="item-color">
                    Color
                  </label>
                  <input
                    id="item-color"
                    className="input"
                    type="text"
                    placeholder="e.g. Crimson, Emerald"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="item-fabric">
                    Fabric
                  </label>
                  <input
                    id="item-fabric"
                    className="input"
                    type="text"
                    placeholder="e.g. Pure Silk, Cotton"
                    value={form.fabric}
                    onChange={(e) => setForm((f) => ({ ...f, fabric: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="item-pattern">
                    Pattern / Work
                  </label>
                  <input
                    id="item-pattern"
                    className="input"
                    list="pattern-datalist"
                    type="text"
                    placeholder="e.g. Zari Border, Floral"
                    value={form.pattern}
                    onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
                  />
                  <datalist id="pattern-datalist">
                    {PATTERN_PRESETS.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
              </div>

              {form.clothingCategory === 'Dresses' && (
                <div className="form-grid-2">
                  <div className="field">
                    <label className="field-label" htmlFor="size-scale">
                      Size Scale
                    </label>
                    <select
                      id="size-scale"
                      className="select"
                      value={form.sizeType}
                      onChange={(e) => handleSizeTypeChange(e.target.value)}
                    >
                      <option value="alpha">Letter Sizes (S, M, L, XL, XXL, Free Size)</option>
                      <option value="numeric">
                        Numeric Sizes (32, 34, 40, 42, 44, 46, Free Size)
                      </option>
                    </select>
                  </div>

                  <div className="field">
                    <label className="field-label" htmlFor="item-size">
                      Dress Size
                    </label>
                    <select
                      id="item-size"
                      className="select"
                      value={form.size}
                      onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                    >
                      {activeSizeList.map((sz) => (
                        <option key={sz} value={sz}>
                          {sz}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label" htmlFor="item-supplier">
                    Supplier / Weaver Name
                  </label>
                  <input
                    id="item-supplier"
                    className="input"
                    type="text"
                    placeholder="Optional"
                    value={form.supplier_name}
                    onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))}
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="item-notes">
                    Notes
                  </label>
                  <input
                    id="item-notes"
                    className="input"
                    type="text"
                    placeholder="Blouse piece details, work notes..."
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Camera Capture + Gallery Upload */}
        <div className="field">
          <label className="field-label">
            Photos (Up to 3 · Take Camera Photo or Upload · Auto-Compressed ~60 KB)
          </label>

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => addCompressedFiles(e.target.files)}
          />

          <input
            ref={cameraCaptureInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => addCompressedFiles(e.target.files)}
          />

          <div className="photo-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={compressing || photos.length >= 3}
              onClick={openCameraCapture}
            >
              <Camera size={16} />
              <span>{compressing ? 'Compressing...' : 'Take Photo (Camera)'}</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={compressing || photos.length >= 3}
              onClick={() => galleryInputRef.current?.click()}
            >
              <Upload size={16} />
              <span>Upload from Device</span>
            </button>
          </div>

          <div className="field-hint">
            Uses phone rear camera directly or laptop webcam, and compresses each image to ~60 KB so
            5 GB D1 holds tens of thousands of photos.
          </div>

          {photos.length > 0 && (
            <div className="photo-preview-grid">
              {photos.map((src, idx) => (
                <div key={idx} className="photo-preview-card">
                  <img src={src} alt={`Preview ${idx + 1}`} />
                  <button
                    type="button"
                    className="photo-remove-btn"
                    onClick={() => removePhoto(idx)}
                    aria-label={`Remove photo ${idx + 1}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 6 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/inventory')}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || compressing}>
            {saving
              ? 'Saving...'
              : isEdit
                ? 'Save Changes'
                : form.enableSeries
                  ? `Create ${activeSeriesSkus.length} Series Item(s)`
                  : 'Save Item'}
          </button>
        </div>
      </form>

      <Modal open={webcamOpen} title="Capture Garment Photo" onClose={closeWebcamModal} maxWidth={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {webcamError ? (
            <div className="alert-banner alert-warning">
              <span>{webcamError}</span>
            </div>
          ) : (
            <video ref={videoRef} className="camera-video-box" autoPlay playsInline muted />
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={closeWebcamModal}>
              Cancel
            </button>
            {!webcamError && (
              <button type="button" className="btn btn-primary" onClick={captureWebcamFrame}>
                <Camera size={15} />
                <span>Snap &amp; Compress</span>
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
