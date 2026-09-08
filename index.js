(function(){
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  let files = []; // { id, file, type: 'pdf'|'image', thumb, pageCount }
  let idCounter = 0;
  let outputFormat = 'pdf';
  let resultBlobUrl = null;

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const listPanel = document.getElementById('listPanel');
  const controlsPanel = document.getElementById('controlsPanel');
  const fileListEl = document.getElementById('fileList');
  const emptyState = document.getElementById('emptyState');
  const countPill = document.getElementById('countPill');
  const mergeBtn = document.getElementById('mergeBtn');
  const mergeBtnText = document.getElementById('mergeBtnText');
  const statusText = document.getElementById('statusText');
  const resultBox = document.getElementById('resultBox');
  const formatToggle = document.getElementById('formatToggle');
  const filenameInput = document.getElementById('filenameInput');
  const extSuffix = document.getElementById('extSuffix');
  const dropSub = document.getElementById('dropSub');
  const dropSubDefault = dropSub.textContent;

  function setDropStatus(msg, isError){
    dropSub.textContent = msg || dropSubDefault;
    dropSub.style.color = isError ? 'var(--danger)' : '';
  }

  function formatSize(bytes){
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/(1024*1024)).toFixed(1) + ' MB';
  }

  function escapeHtml(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function extractZip(zipFile){
    if (typeof JSZip === 'undefined'){
      throw new Error('Zip library failed to load — check your connection and reload.');
    }
    const zip = await JSZip.loadAsync(zipFile);
    const extracted = [];
    const names = Object.keys(zip.files).sort((a, b) => a.localeCompare(b));
    for (const name of names){
      const entry = zip.files[name];
      if (entry.dir) continue;
      const baseName = name.split('/').pop();
      if (!baseName || baseName.startsWith('.')) continue; // skip hidden/system files
      if (/\.pdf$/i.test(baseName)){
        const blob = await entry.async('blob');
        extracted.push(new File([blob], baseName, { type: 'application/pdf' }));
      } else if (/\.(png|jpe?g)$/i.test(baseName)){
        const blob = await entry.async('blob');
        const type = /\.png$/i.test(baseName) ? 'image/png' : 'image/jpeg';
        extracted.push(new File([blob], baseName, { type }));
      }
    }
    return extracted;
  }

  async function addFiles(fileArr){
    const expanded = [];
    for (const file of fileArr){
      const isZip = file.type === 'application/zip' ||
                    file.type === 'application/x-zip-compressed' ||
                    /\.zip$/i.test(file.name);
      if (isZip){
        setDropStatus(`Extracting ${file.name}…`, false);
        try {
          const inner = await extractZip(file);
          if (inner.length === 0){
            setDropStatus(`No PDFs or images found inside ${file.name}.`, true);
          }
          expanded.push(...inner);
        } catch(e){
          console.error(e);
          setDropStatus(`Could not read ${file.name} as a zip file.`, true);
        }
      } else {
        expanded.push(file);
      }
    }
    if (dropSub.textContent.startsWith('Extracting')) setDropStatus();

    for (const file of expanded){
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isImage = file.type === 'image/png' || file.type === 'image/jpeg' || /\.(png|jpe?g)$/i.test(file.name);
      if (!isPdf && !isImage) continue;
      const item = {
        id: 'f' + (idCounter++),
        file,
        type: isPdf ? 'pdf' : 'image',
        thumb: null,
        pageCount: null,
        isDuplicate: false,
        dismissedDuplicate: false
      };
      files.push(item);
      if (item.type === 'image'){
        item.thumb = URL.createObjectURL(file);
      } else {
        generatePdfThumb(item);
      }
    }
    render();
  }

  async function generatePdfThumb(item){
    try {
      const buf = await item.file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      item.pageCount = pdf.numPages;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.35 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      item.thumb = canvas.toDataURL();
      render();
    } catch(e){
      item.thumb = null;
      render();
    }
  }

  function recomputeDuplicates(){
    const seen = new Map();
    for (const item of files){
      const key = item.file.name.trim().toLowerCase() + '|' + item.file.size;
      if (seen.has(key)){
        item.isDuplicate = !item.dismissedDuplicate;
      } else {
        item.isDuplicate = false;
        seen.set(key, true);
      }
    }
  }

  function render(){
    recomputeDuplicates();

    listPanel.style.display = files.length > 0 || controlsPanel.style.display !== 'none' ? 'block' : 'none';
    controlsPanel.style.display = files.length > 0 ? 'block' : 'none';
    listPanel.style.display = files.length > 0 ? 'block' : 'none';

    countPill.textContent = files.length + (files.length === 1 ? ' file' : ' files');
    emptyState.style.display = files.length === 0 ? 'block' : 'none';

    fileListEl.innerHTML = files.map((item, index) => {
      const thumbHtml = item.thumb
        ? `<img src="${item.thumb}" alt="">`
        : (item.type === 'pdf'
            ? `<span style="font-size:10px;color:#5B6472;font-family:'JetBrains Mono',monospace;">PDF</span>`
            : `<span style="font-size:10px;color:#5B6472;">…</span>`);
      const pages = item.pageCount ? ` · ${item.pageCount} page${item.pageCount > 1 ? 's' : ''}` : '';
      const dupWarning = item.isDuplicate ? `
            <div class="dup-warning">
              <span>⚠ This looks like a duplicate of a file already in the list.</span>
              <span class="dup-actions">
                <button class="dup-remove" data-id="${item.id}">Remove this</button>
                <button class="dup-keep" data-id="${item.id}">Keep anyway</button>
              </span>
            </div>` : '';
      return `
        <li class="file-item${item.isDuplicate ? ' is-duplicate' : ''}" draggable="true" data-id="${item.id}">
          <span class="handle">⠿</span>
          <span class="badge">${String(index + 1).padStart(2,'0')}</span>
          <div class="thumb">${thumbHtml}</div>
          <div class="meta">
            <div class="name">${escapeHtml(item.file.name)}</div>
            <div class="sub-meta">${item.type.toUpperCase()} · ${formatSize(item.file.size)}${pages}</div>
            ${dupWarning}
          </div>
          <button class="remove" data-id="${item.id}" title="Remove">✕</button>
        </li>`;
    }).join('');
  }

  // Drop zone interactions
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    await addFiles(Array.from(e.target.files));
    fileInput.value = '';
  });
  ['dragenter','dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave','drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', async (e) => {
    const dropped = Array.from(e.dataTransfer.files || []);
    await addFiles(dropped);
  });

  // Remove + reorder
  fileListEl.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove');
    if (removeBtn){
      const id = removeBtn.dataset.id;
      files = files.filter(f => f.id !== id);
      render();
      return;
    }
    const dupRemoveBtn = e.target.closest('.dup-remove');
    if (dupRemoveBtn){
      const id = dupRemoveBtn.dataset.id;
      files = files.filter(f => f.id !== id);
      render();
      return;
    }
    const dupKeepBtn = e.target.closest('.dup-keep');
    if (dupKeepBtn){
      const id = dupKeepBtn.dataset.id;
      const item = files.find(f => f.id === id);
      if (item) item.dismissedDuplicate = true;
      render();
      return;
    }
  });

  let dragSrcIndex = null;
  fileListEl.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.file-item');
    if (!li) return;
    dragSrcIndex = Array.from(fileListEl.children).indexOf(li);
    e.dataTransfer.effectAllowed = 'move';
  });
  fileListEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const li = e.target.closest('.file-item');
    if (li) li.classList.add('drag-over');
  });
  fileListEl.addEventListener('dragleave', (e) => {
    const li = e.target.closest('.file-item');
    if (li) li.classList.remove('drag-over');
  });
  fileListEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const li = e.target.closest('.file-item');
    if (!li || dragSrcIndex === null) return;
    li.classList.remove('drag-over');
    const targetIndex = Array.from(fileListEl.children).indexOf(li);
    if (targetIndex === dragSrcIndex) return;
    const [moved] = files.splice(dragSrcIndex, 1);
    files.splice(targetIndex, 0, moved);
    dragSrcIndex = null;
    render();
  });

  // Format toggle
  formatToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    outputFormat = btn.dataset.format;
    Array.from(formatToggle.children).forEach(b => b.classList.toggle('active', b === btn));
    extSuffix.textContent = outputFormat === 'pdf' ? '.pdf' : '.docx';
  });

  function sanitizeFilename(name){
    const cleaned = name.trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\.+$/, '');
    return cleaned || 'merged-document';
  }

  function getImageDimensions(file){
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function fitToDocWidth(w, h){
    const maxWidth = 580; // px, fits a Letter page with margins at 96dpi-equivalent
    const scale = Math.min(maxWidth / w, 1);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }

  async function mergeToPdf(items){
    const { PDFDocument } = PDFLib;
    const mergedPdf = await PDFDocument.create();
    const pageWidth = 595.28, pageHeight = 841.89; // A4
    const margin = 36;

    for (const item of items){
      const bytes = await item.file.arrayBuffer();
      if (item.type === 'pdf'){
        const donor = await PDFDocument.load(bytes);
        const copiedPages = await mergedPdf.copyPages(donor, donor.getPageIndices());
        copiedPages.forEach(p => mergedPdf.addPage(p));
      } else {
        let image;
        if (item.file.type === 'image/png' || /\.png$/i.test(item.file.name)){
          image = await mergedPdf.embedPng(bytes);
        } else {
          image = await mergedPdf.embedJpg(bytes);
        }
        const maxW = pageWidth - margin * 2;
        const maxH = pageHeight - margin * 2;
        const scale = Math.min(maxW / image.width, maxH / image.height, 1);
        const w = image.width * scale, h = image.height * scale;
        const page = mergedPdf.addPage([pageWidth, pageHeight]);
        page.drawImage(image, {
          x: (pageWidth - w) / 2,
          y: (pageHeight - h) / 2,
          width: w,
          height: h
        });
      }
    }
    const bytes = await mergedPdf.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  async function mergeToDocx(items){
    const { Document, Packer, Paragraph, ImageRun, PageBreak } = docx;
    const children = [];

    for (let idx = 0; idx < items.length; idx++){
      const item = items[idx];
      if (item.type === 'image'){
        const buf = await item.file.arrayBuffer();
        const dims = await getImageDimensions(item.file);
        const size = fitToDocWidth(dims.width, dims.height);
        const imgType = (item.file.type === 'image/png' || /\.png$/i.test(item.file.name)) ? 'png' : 'jpg';
        children.push(new Paragraph({
          children: [ new ImageRun({ type: imgType, data: new Uint8Array(buf), transformation: size }) ]
        }));
      } else {
        const buf = await item.file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        for (let p = 1; p <= pdf.numPages; p++){
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          const pngBuf = await pngBlob.arrayBuffer();
          const size = fitToDocWidth(viewport.width, viewport.height);
          children.push(new Paragraph({
            children: [ new ImageRun({ type: 'png', data: new Uint8Array(pngBuf), transformation: size }) ]
          }));
          if (p < pdf.numPages){
            children.push(new Paragraph({ children: [ new PageBreak() ] }));
          }
        }
      }
      if (idx < items.length - 1){
        children.push(new Paragraph({ children: [ new PageBreak() ] }));
      }
    }

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    return blob;
  }

  mergeBtn.addEventListener('click', async () => {
    if (files.length === 0) return;

    if (outputFormat === 'docx' && window.__docxReady){
      await window.__docxReady;
    }

    if (typeof PDFLib === 'undefined' || typeof pdfjsLib === 'undefined' || (outputFormat === 'docx' && typeof docx === 'undefined')){
      statusText.textContent = 'Could not load a required library — check your internet connection and reload.';
      statusText.classList.add('error');
      return;
    }

    mergeBtn.disabled = true;
    mergeBtnText.textContent = 'Merging…';
    statusText.classList.remove('error');
    statusText.textContent = 'Working through your files in order…';
    resultBox.innerHTML = '';

    try {
      const blob = outputFormat === 'pdf' ? await mergeToPdf(files) : await mergeToDocx(files);
      const ext = outputFormat === 'pdf' ? 'pdf' : 'docx';
      const filename = `${sanitizeFilename(filenameInput.value)}.${ext}`;

      if (resultBlobUrl) URL.revokeObjectURL(resultBlobUrl);
      resultBlobUrl = URL.createObjectURL(blob);

      statusText.textContent = '';
      resultBox.innerHTML = `
        <div class="result">
          <div class="result-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 9.5L7.2 12.7L14 5.3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="result-meta">
            <div class="result-name">${filename}</div>
            <div class="result-sub">${formatSize(blob.size)} · ${files.length} source file${files.length > 1 ? 's' : ''} merged</div>
          </div>
          <a class="download-btn" href="${resultBlobUrl}" download="${filename}">Download</a>
        </div>
        <div style="padding:12px 20px 18px;">
          <button class="start-over" id="startOverBtn">Start over with new files</button>
        </div>
      `;
      document.getElementById('startOverBtn').addEventListener('click', () => {
        files = [];
        resultBox.innerHTML = '';
        statusText.textContent = '';
        render();
      });
    } catch(err){
      console.error(err);
      statusText.classList.add('error');
      statusText.textContent = 'Something went wrong while merging: ' + (err.message || err);
    } finally {
      mergeBtn.disabled = false;
      mergeBtnText.textContent = 'Merge documents';
    }
  });

  render();
})();
