const designer = document.querySelector('[data-pdf-designer]');
const documentPreview = document.querySelector('[data-pdf-document]');

if (designer || documentPreview) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

  if (designer) {
    setupDesigner(pdfjs, designer);
  }

  if (documentPreview) {
    setupDocumentPreview(pdfjs, JSON.parse(documentPreview.textContent));
  }
}

function setupDesigner(pdfjs, form) {
  const upload = form.querySelector('[data-pdf-upload]');
  const status = form.querySelector('[data-pdf-status]');
  const canvas = form.querySelector('[data-pdf-canvas]');
  const wrap = form.querySelector('[data-pdf-canvas-wrap]');
  const field = form.querySelector('[data-signature-field]');
  const saveButton = form.querySelector('[data-save-template]');
  const pdfDataInput = form.querySelector('[data-pdf-data-url]');
  const fileNameInput = form.querySelector('[data-pdf-file-name]');
  const inputs = {
    page: form.querySelector('[data-signature-page]'),
    x: form.querySelector('[data-signature-x]'),
    y: form.querySelector('[data-signature-y]'),
    width: form.querySelector('[data-signature-width]'),
    height: form.querySelector('[data-signature-height]')
  };

  field.hidden = true;

  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file) {
      return;
    }

    if (file.type !== 'application/pdf') {
      status.textContent = 'Choose a PDF file.';
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    pdfDataInput.value = dataUrl;
    fileNameInput.value = file.name;
    status.textContent = `Loaded ${file.name}. Click the page to move the signature field.`;
    await renderPdfDataUrl(pdfjs, dataUrl, canvas, wrap);
    positionField(field, fieldFromInputs(inputs));
    field.hidden = false;
    saveButton.disabled = false;
  });

  wrap.addEventListener('click', (event) => {
    if (!pdfDataInput.value || event.target === field || field.contains(event.target)) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const width = Number.parseFloat(inputs.width.value);
    const height = Number.parseFloat(inputs.height.value);
    const next = {
      page: 1,
      x: clamp((event.clientX - rect.left) / rect.width - width / 2, 0, 1 - width),
      y: clamp((event.clientY - rect.top) / rect.height - height / 2, 0, 1 - height),
      width,
      height
    };
    writeFieldInputs(inputs, next);
    positionField(field, next);
  });

  enableFieldDrag(wrap, field, (next) => {
    writeFieldInputs(inputs, next);
    positionField(field, next);
  }, () => fieldFromInputs(inputs));
}

function setupDocumentPreview(pdfjs, documentData) {
  const canvas = document.querySelector('[data-pdf-canvas]');
  const wrap = document.querySelector('[data-pdf-canvas-wrap]');
  const field = document.querySelector('[data-signature-field]');
  const modalButtons = document.querySelectorAll('[data-open-signature-modal]');
  const envelopeShell = document.querySelector('[data-envelope-id]');
  const statusElement = document.querySelector('[data-envelope-status]');
  const labelElement = document.querySelector('[data-signature-label]');
  const metaElement = document.querySelector('[data-signature-meta]');

  renderPdfDataUrl(pdfjs, documentData.pdfDataUrl, canvas, wrap).then(() => {
    positionField(field, documentData.signatureField);
  });

  modalButtons.forEach((modalButton) => modalButton.addEventListener('click', () => {
    const modal = window.bootstrap?.Modal?.getOrCreateInstance(document.getElementById('signatureConfirmModal'));
    modal?.show();
  }));

  if (!envelopeShell || documentData.status === 'signed') {
    return;
  }

  const envelopeId = envelopeShell.dataset.envelopeId;
  window.setInterval(async () => {
    try {
      const response = await fetch(`/signatures/envelopes/${envelopeId}/status`);
      const payload = await response.json();
      if (payload.status !== 'signed') {
        statusElement.textContent = payload.status;
        return;
      }

      statusElement.textContent = 'signed';
      field.classList.remove('status-pending-wallet');
      field.classList.add('status-signed');
      labelElement.textContent = 'Digitally signed';
      metaElement.textContent = `${payload.signedBy} · ${payload.signedAt} · ${payload.signatureId}`;
    } catch (error) {
      statusElement.textContent = 'pending-wallet';
    }
  }, 2400);
}

async function renderPdfDataUrl(pdfjs, dataUrl, canvas, wrap) {
  const bytes = dataUrlToUint8Array(dataUrl);
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.25 });
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  await page.render({ canvasContext: context, viewport }).promise;
  wrap.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
}

function fieldFromInputs(inputs) {
  return {
    page: Number.parseInt(inputs.page.value || '1', 10),
    x: Number.parseFloat(inputs.x.value || '0.08'),
    y: Number.parseFloat(inputs.y.value || '0.66'),
    width: Number.parseFloat(inputs.width.value || '0.34'),
    height: Number.parseFloat(inputs.height.value || '0.12')
  };
}

function writeFieldInputs(inputs, field) {
  inputs.page.value = String(field.page || 1);
  inputs.x.value = field.x.toFixed(4);
  inputs.y.value = field.y.toFixed(4);
  inputs.width.value = field.width.toFixed(4);
  inputs.height.value = field.height.toFixed(4);
}

function positionField(element, field) {
  element.style.left = `${field.x * 100}%`;
  element.style.top = `${field.y * 100}%`;
  element.style.width = `${field.width * 100}%`;
  element.style.height = `${field.height * 100}%`;
}

function enableFieldDrag(wrap, field, onMove, readCurrent) {
  let start = null;

  field.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    field.setPointerCapture(event.pointerId);
    start = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      field: readCurrent()
    };
  });

  field.addEventListener('pointermove', (event) => {
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const next = {
      ...start.field,
      x: clamp(start.field.x + (event.clientX - start.clientX) / rect.width, 0, 1 - start.field.width),
      y: clamp(start.field.y + (event.clientY - start.clientY) / rect.height, 0, 1 - start.field.height)
    };
    onMove(next);
  });

  field.addEventListener('pointerup', (event) => {
    if (start?.pointerId === event.pointerId) {
      start = null;
    }
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(reader.error || new Error('Could not read PDF.')));
    reader.readAsDataURL(file);
  });
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
