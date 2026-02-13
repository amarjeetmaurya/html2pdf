const { jsPDF } = window.jspdf;
console.log("first")
// ── state ──────────────────────────────────────────────────────────────────
let htmlContent = null;
let fileName = '';

// ── ui refs ─────────────────────────────────────────────────────────────────
const fileInput     = document.getElementById('fileInput');
const dropzone      = document.getElementById('dropzone');
const fileNameEl    = document.getElementById('fileName');
const fileNameText  = document.getElementById('fileNameText');
const convertBtn    = document.getElementById('convertBtn');
const progressWrap  = document.getElementById('progressWrap');
const progressBar   = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const progressPct   = document.getElementById('progressPct');
const logEl         = document.getElementById('log');

// ── logging ──────────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  logEl.classList.add('visible');
  const line = document.createElement('div');
  line.className = type;
  line.textContent = `> ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(pct, label) {
  progressBar.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  if (label) progressLabel.textContent = label;
}

// ── file handling ─────────────────────────────────────────────────────────
function loadFile(file) {
  if (!file || !file.name.match(/\.html?$/i)) {
    log('Please select a valid .html file', 'err');
    return;
  }
  fileName = file.name.replace(/\.html?$/i, '');
  document.getElementById('outputName').placeholder = fileName + '.pdf';

  const reader = new FileReader();
  reader.onload = e => {
    htmlContent = e.target.result;
    fileNameText.textContent = file.name;
    fileNameEl.classList.add('visible');
    dropzone.classList.add('has-file');
    convertBtn.disabled = false;
    log(`Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'ok');
  };
  reader.readAsText(file);
}

fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});

// ── PAGE SIZE MAP ─────────────────────────────────────────────────────────
const PAGE_SIZES = {
  a4:     [595.28, 841.89],
  letter: [612,    792],
  legal:  [612,    1008],
};

// ── MAIN CONVERSION ───────────────────────────────────────────────────────
convertBtn.addEventListener('click', async () => {
  if (!htmlContent) return;

  convertBtn.disabled = true;
  logEl.innerHTML = '';
  logEl.classList.add('visible');
  progressWrap.classList.add('visible');
  setProgress(0, 'Preparing sandbox…');

  const preserveLinks = document.getElementById('preserveLinks').checked;
  const detectUrls    = document.getElementById('detectUrls').checked;
  const newTab        = document.getElementById('newTab').checked;
  const pageSizeKey   = document.getElementById('pageSize').value;
  const orientation   = document.getElementById('orientation').value;
  const scale         = parseInt(document.getElementById('imgScale').value);
  const outName       = document.getElementById('outputName').value.trim() || (fileName + '.pdf');
  const finalName     = outName.endsWith('.pdf') ? outName : outName + '.pdf';

  try {
    // 1. Inject HTML into hidden iframe ────────────────────────────────────
    log('Creating sandbox iframe…');
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:8.5in;height:11in;border:none;visibility:hidden;';
    document.body.appendChild(iframe);

    const iDoc = iframe.contentDocument || iframe.contentWindow.document;
    iDoc.open();
    iDoc.write(htmlContent);
    iDoc.close();

    // Wait for resources to load
    await new Promise(r => setTimeout(r, 800));
    setProgress(10, 'Scanning links…');

    // 2. Collect all anchor elements with positions ────────────────────────
    const iWin  = iframe.contentWindow;
    const iBody = iDoc.body;
    const anchors = [];

    if (preserveLinks) {
      const allLinks = iDoc.querySelectorAll('a[href]');
      log(`Found ${allLinks.length} anchor tags`);

      allLinks.forEach(a => {
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#')) return;

        const rect   = a.getBoundingClientRect
          ? a.getBoundingClientRect()
          : { left: 0, top: 0, width: 0, height: 0 };
        const iRect  = iframe.getBoundingClientRect();

        // Get position relative to the iframe's scroll
        const scrollY = iWin.scrollY || iDoc.documentElement.scrollTop || 0;
        const scrollX = iWin.scrollX || iDoc.documentElement.scrollLeft || 0;
        const domRect = a.getBoundingClientRect();

        // We need absolute position inside the iframe document
        let el = a;
        let top = 0, left = 0;
        while (el && el !== iBody) {
          top  += el.offsetTop  || 0;
          left += el.offsetLeft || 0;
          el    = el.offsetParent;
        }

        anchors.push({
          href,
          x:      left,
          y:      top,
          width:  a.offsetWidth  || 10,
          height: a.offsetHeight || 12,
        });
      });

      log(`Mapped ${anchors.length} link positions`, 'ok');
    }

    // 3. Render to canvas ──────────────────────────────────────────────────
    setProgress(20, 'Rendering HTML to canvas…');
    log(`Rendering at ${scale}× scale…`);

    const canvas = await html2canvas(iDoc.body, {
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth:  iDoc.documentElement.scrollWidth,
      windowHeight: iDoc.documentElement.scrollHeight,
    });

    setProgress(65, 'Building PDF…');
    log('Canvas rendered: ' + canvas.width + '×' + canvas.height + 'px', 'ok');

    // 4. Create PDF ────────────────────────────────────────────────────────
    const [pw, ph] = PAGE_SIZES[pageSizeKey];
    const isLandscape = orientation === 'landscape';
    const pdfW = isLandscape ? ph : pw;
    const pdfH = isLandscape ? pw : ph;

    const pdf = new jsPDF({
      orientation,
      unit: 'pt',
      format: pageSizeKey,
    });

    // Image dimensions
    const imgW = canvas.width;
    const imgH = canvas.height;
    const ratio = pdfW / (imgW / scale);  // pts per CSS pixel

    const imgData = canvas.toDataURL('image/jpeg', 0.97);
    setProgress(75, 'Embedding image…');

    // Handle multi-page
    const totalPdfHeight = (imgH / scale) * ratio;
    const pageCount = Math.ceil(totalPdfHeight / pdfH);
    log(`Pages: ${pageCount}, PDF size: ${pdfW.toFixed(0)}×${pdfH.toFixed(0)}pt`);

    for (let p = 0; p < pageCount; p++) {
      if (p > 0) pdf.addPage();

      const srcY      = p * pdfH / ratio * scale;
      const srcHeight = Math.min(pdfH / ratio * scale, imgH - srcY);

      // Slice the canvas for this page
      const pageCanvas  = document.createElement('canvas');
      pageCanvas.width  = imgW;
      pageCanvas.height = srcHeight;
      const ctx = pageCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, srcY, imgW, srcHeight, 0, 0, imgW, srcHeight);
      const pageData = pageCanvas.toDataURL('image/jpeg', 0.97);

      pdf.addImage(pageData, 'JPEG', 0, 0, pdfW, (srcHeight / scale) * ratio);
      setProgress(75 + Math.round((p + 1) / pageCount * 15), `Rendering page ${p + 1}/${pageCount}…`);
    }

    // 5. Add link annotations ──────────────────────────────────────────────
    if (preserveLinks && anchors.length > 0) {
      setProgress(92, 'Injecting link annotations…');

      anchors.forEach(({ href, x, y, width, height }) => {
        // Which page does this link land on?
        const yPt     = y * ratio;
        const pageIdx = Math.floor(yPt / pdfH);
        const yOnPage = yPt - pageIdx * pdfH;

        if (pageIdx >= pageCount) return;

        pdf.setPage(pageIdx + 1);

        // jsPDF link annotation
        pdf.link(
          x * ratio,
          yOnPage,
          width  * ratio,
          height * ratio,
          { url: href }
        );
      });

      log(`Injected ${anchors.length} clickable link annotations`, 'ok');
    }

    // 6. Save ──────────────────────────────────────────────────────────────
    setProgress(98, 'Saving…');
    pdf.save(finalName);

    setProgress(100, 'Done!');
    log(`Saved as: ${finalName}`, 'ok');

    // Cleanup
    document.body.removeChild(iframe);

  } catch (err) {
    log('Error: ' + err.message, 'err');
    console.error(err);
  }

  convertBtn.disabled = false;
});
