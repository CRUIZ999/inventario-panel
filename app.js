// =========================
// CONFIGURACIÓN
// =========================

// CSV en la MISMA carpeta que index.html, app.js y styles.css
// Nombre del archivo en el repo: inventario.csv
const CSV_URL = "inventario.csv";


// Datos en memoria
let rawData = [];      // todos los registros
let filteredData = []; // registros filtrados

let sortConfig = {
  key: null,
  direction: "asc", // "asc" o "desc"
};

const state = {
  search: "",
  clasifActivas: new Set(),   // ej: { "A", "B" }
  filtroCobertura: "all",     // all | critico | medio | alto
};

// =========================
// INICIALIZACIÓN
// =========================

document.addEventListener("DOMContentLoaded", () => {
  // 1) Cargar CSV automáticamente al abrir la página
  cargarCSVDesdeRepositorio();

  // 2) Listeners de UI
  const fileInput       = document.getElementById("fileInput");
  const searchInput     = document.getElementById("searchInput");
  const coberturaSelect = document.getElementById("coberturaSelect");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  const headerCells     = document.querySelectorAll("#dataTable thead th");

  // Opción extra: permitir subir otro CSV manualmente (sobrescribe datos)
  if (fileInput) {
    fileInput.addEventListener("change", handleFileUpload);
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.search = e.target.value.toLowerCase();
      aplicarFiltrosYRender();
    });
  }

  if (coberturaSelect) {
    coberturaSelect.addEventListener("change", (e) => {
      state.filtroCobertura = e.target.value;
      aplicarFiltrosYRender();
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      state.search = "";
      state.clasifActivas.clear();
      state.filtroCobertura = "all";
      if (coberturaSelect) coberturaSelect.value = "all";
      sincronizarChipsUI();
      aplicarFiltrosYRender();
    });
  }

  headerCells.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      sortByColumn(key, th.classList.contains("is-numeric"));
    });
  });
});

// =========================
// CARGA AUTOMÁTICA DESDE EL REPO
// =========================

async function cargarCSVDesdeRepositorio() {
  const statusEl = document.getElementById("fileStatus");

  try {
    if (statusEl) statusEl.textContent = "Cargando CSV (inventario.csv)…";

    // Como el CSV está en la misma carpeta, basta la ruta relativa
    const resp = await fetch(CSV_URL);

    if (!resp.ok) {
      throw new Error("HTTP " + resp.status + " al leer " + CSV_URL);
    }

    const text = await resp.text();

    rawData      = parseCSV(text);
    filteredData = [...rawData];

    if (statusEl) {
      statusEl.textContent = `CSV cargado automáticamente (${rawData.length} filas).`;
    }

    construirChipsClasificacion(rawData);
    aplicarFiltrosYRender(true);

  } catch (err) {
    console.error("Error al cargar CSV desde el repositorio:", err);
    if (statusEl) {
      statusEl.textContent =
        "Error al cargar el CSV desde GitHub. Verifica que 'inventario.csv' exista en la misma carpeta.";
    }
  }
}

// =========================
// SUBIR CSV MANUAL (OPCIONAL)
// =========================

function handleFileUpload(ev) {
  const file = ev.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;

    rawData      = parseCSV(text);
    filteredData = [...rawData];

    const statusEl = document.getElementById("fileStatus");
    if (statusEl) {
      statusEl.textContent = `Archivo cargado manualmente (${rawData.length} filas).`;
    }

    construirChipsClasificacion(rawData);
    aplicarFiltrosYRender(true);
  };

  reader.readAsText(file, "UTF-8");
}

// =========================
// PARSE CSV
// =========================

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  // Detectar si usa , o ; como separador
  const firstLine = lines[0];
  const delimiter =
    firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";

  const headers = firstLine.split(delimiter).map((h) => h.trim().toLowerCase());

  // Buscar índices según tus encabezados reales del CSV
  const idx = {
    codigo: headers.indexOf("codigo"),
    clave: headers.indexOf("clave"),
    desc_prod: headers.indexOf("desc_prod"),
    inv: headers.indexOf("inv"),
    clasificacion: headers.indexOf("clasificacion"),
    promedio_vta_mes: headers.indexOf("promedio vta mes"),
    cobertura_mes: headers.indexOf("cobertura (mes)"),
    cobertura_dias_30: headers.indexOf("cobertura dias (30)"),
  };

  return lines.slice(1).reduce((acc, line) => {
    if (!line.trim()) return acc;

    const cols = line.split(delimiter);

    const record = {
      codigo:           getCell(cols, idx.codigo),
      clave:            getCell(cols, idx.clave),
      desc_prod:        getCell(cols, idx.desc_prod),
      inv:              parseNumber(getCell(cols, idx.inv)),
      clasificacion:    getCell(cols, idx.clasificacion),
      promedio_vta_mes: parseNumber(getCell(cols, idx.promedio_vta_mes)),
      cobertura_mes:    parseNumber(getCell(cols, idx.cobertura_mes)),
      cobertura_dias_30:parseNumber(getCell(cols, idx.cobertura_dias_30)),
    };

    acc.push(record);
    return acc;
  }, []);
}

function getCell(cols, index) {
  if (index === -1 || index == null) return "";
  return (cols[index] || "").trim();
}

function parseNumber(v) {
  if (!v) return 0;
  const normalized = v.replace(/,/g, "");
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

// =========================
// FILTROS
// =========================

function aplicarFiltrosYRender(resetSort = false) {
  if (!rawData.length) {
    renderTable([]);
    renderKPIs([]);
    renderResumenClasif([]);
    return;
  }

  let data = [...rawData];

  // Búsqueda texto
  if (state.search) {
    const term = state.search;
    data = data.filter((row) => {
      return (
        String(row.codigo).toLowerCase().includes(term)   ||
        String(row.clave).toLowerCase().includes(term)    ||
        String(row.desc_prod).toLowerCase().includes(term)
      );
    });
  }

  // Filtro por clasificación (chips)
  if (state.clasifActivas.size > 0) {
    data = data.filter((row) => state.clasifActivas.has(row.clasificacion));
  }

  // Filtro por cobertura (Mes)
  if (state.filtroCobertura !== "all") {
    data = data.filter((row) => {
      const c = row.cobertura_mes;
      if (state.filtroCobertura === "critico") return c >= 0 && c <= 1;
      if (state.filtroCobertura === "medio")   return c > 1 && c <= 3;
      if (state.filtroCobertura === "alto")    return c > 3;
      return true;
    });
  }

  filteredData = data;

  if (resetSort) {
    sortConfig.key = null;
    sortConfig.direction = "asc";
  }

  if (sortConfig.key) {
    data = sortData(data, sortConfig.key);
  }

  renderKPIs(data);
  renderResumenClasif(data);
  renderTable(data);
}

// =========================
// ORDENAR TABLA
// =========================

function sortByColumn(key, isNumeric) {
  if (!key) return;

  if (sortConfig.key === key) {
    sortConfig.direction = sortConfig.direction === "asc" ? "desc" : "asc";
  } else {
    sortConfig.key = key;
    sortConfig.direction = "asc";
  }

  const data = sortData([...filteredData], key, isNumeric);
  renderTable(data);
}

function sortData(data, key, isNumericOverride = false) {
  const dir = sortConfig.direction === "asc" ? 1 : -1;

  return data.sort((a, b) => {
    const va = a[key];
    const vb = b[key];

    const isNumeric =
      isNumericOverride || typeof va === "number" || typeof vb === "number";

    if (isNumeric) {
      return (va - vb) * dir;
    }
    return String(va).localeCompare(String(vb)) * dir;
  });
}

// =========================
// KPIs
// =========================

function renderKPIs(data) {
  const total     = rawData.length;
  const filtrados = data.length;

  const kpiProductos     = document.getElementById("kpiProductos");
  const kpiInventario    = document.getElementById("kpiInventario");
  const kpiPromedioVenta = document.getElementById("kpiPromedioVenta");
  const kpiCobertura     = document.getElementById("kpiCobertura");

  if (!data.length) {
    if (kpiProductos)     kpiProductos.textContent     = "0 / " + total;
    if (kpiInventario)    kpiInventario.textContent    = "0";
    if (kpiPromedioVenta) kpiPromedioVenta.textContent = "0";
    if (kpiCobertura)     kpiCobertura.textContent     = "0";
    return;
  }

  const invTotal   = data.reduce((acc, r) => acc + (r.inv || 0), 0);
  const promVenta  = data.reduce((acc, r) => acc + (r.promedio_vta_mes || 0), 0);
  const promCobert =
    data.reduce((acc, r) => acc + (r.cobertura_dias_30 || 0), 0) / data.length;

  if (kpiProductos) {
    kpiProductos.textContent =
      `${filtrados.toLocaleString()} / ${total.toLocaleString()}`;
  }

  if (kpiInventario) {
    kpiInventario.textContent = invTotal.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    });
  }

  if (kpiPromedioVenta) {
    kpiPromedioVenta.textContent = promVenta.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    });
  }

  if (kpiCobertura) {
    kpiCobertura.textContent = promCobert.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }
}

// =========================
// RESUMEN POR CLASIFICACIÓN
// =========================

function renderResumenClasif(data) {
  const container = document.getElementById("clasifSummary");
  if (!container) return;

  container.innerHTML = "";
  if (!data.length) return;

  const map = {};
  data.forEach((r) => {
    const c = r.clasificacion || "Sin";
    if (!map[c]) map[c] = { count: 0, inv: 0 };
    map[c].count += 1;
    map[c].inv   += r.inv || 0;
  });

  Object.entries(map).forEach(([clasif, info]) => {
    const pill = document.createElement("div");
    pill.className = "summary-pill";

    const dot = document.createElement("span");
    dot.className = `summary-dot ${clasif}`;
    pill.appendChild(dot);

    const label = document.createElement("span");
    label.textContent = `Clasif ${clasif}`;
    pill.appendChild(label);

    const detail = document.createElement("span");
    detail.style.color = "var(--text-muted)";
    detail.textContent =
      `· ${info.count.toLocaleString()} prod · Inv ${info.inv.toLocaleString()}`;
    pill.appendChild(detail);

    container.appendChild(pill);
  });
}

// =========================
// TABLA
// =========================

function renderTable(data) {
  const tbody = document.querySelector("#dataTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const rowsInfo = document.getElementById("rowsInfo");
  if (rowsInfo) {
    rowsInfo.textContent = `${data.length.toLocaleString()} registros`;
  }

  if (!data.length) return;

  data.forEach((row) => {
    const tr = document.createElement("tr");

    // Código
    const tdCodigo = document.createElement("td");
    tdCodigo.textContent = row.codigo;
    tr.appendChild(tdCodigo);

    // Clave
    const tdClave = document.createElement("td");
    tdClave.textContent = row.clave;
    tr.appendChild(tdClave);

    // Descripción
    const tdDesc = document.createElement("td");
    tdDesc.textContent = row.desc_prod;
    tr.appendChild(tdDesc);

    // Inv
    const tdInv = document.createElement("td");
    tdInv.classList.add("is-numeric");
    tdInv.textContent = formatNumber(row.inv);
    tr.appendChild(tdInv);

    // Clasificación
    const tdClasif = document.createElement("td");
    const badge    = document.createElement("span");
    const c        = row.clasificacion || "–";
    badge.className = `badge-clasif ${c}`;
    badge.textContent = c;
    tdClasif.appendChild(badge);
    tr.appendChild(tdClasif);

    // Promedio Vta Mes
    const tdProm = document.createElement("td");
    tdProm.classList.add("is-numeric");
    tdProm.textContent = formatNumber(row.promedio_vta_mes);
    tr.appendChild(tdProm);

    // Cobertura (Mes)
    const tdCobMes = document.createElement("td");
    tdCobMes.classList.add("is-numeric");
    tdCobMes.textContent = formatNumber(row.cobertura_mes, 1);
    tr.appendChild(tdCobMes);

    // Cobertura Días (30) con heat map
    const tdCobDias = document.createElement("td");
    tdCobDias.classList.add("is-numeric");
    tdCobDias.textContent = formatNumber(row.cobertura_dias_30);

    const d = row.cobertura_dias_30;
    if (d <= 30)        tdCobDias.classList.add("heat-low");
    else if (d <= 90)   tdCobDias.classList.add("heat-mid");
    else if (d > 90)    tdCobDias.classList.add("heat-high");

    tr.appendChild(tdCobDias);

    tbody.appendChild(tr);
  });
}

function formatNumber(n, decimals = 0) {
  if (typeof n !== "number") return "";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// =========================
// CHIPS DE CLASIFICACIÓN
// =========================

function construirChipsClasificacion(data) {
  const container = document.getElementById("clasifChips");
  if (!container) return;

  container.innerHTML = "";

  const clasifs = Array.from(
    new Set(
      data
        .map((r) => r.clasificacion)
        .filter((v) => v !== undefined && v !== null && v !== "")
    )
  ).sort();

  clasifs.forEach((c) => {
    const chip = document.createElement("div");
    chip.className = `chip ${c}`;
    chip.dataset.value = c;
    chip.innerHTML = `<strong>${c}</strong><span>0</span>`;
    chip.addEventListener("click", () => toggleClasifChip(c));
    container.appendChild(chip);
  });

  actualizarContadoresChips();
}

function toggleClasifChip(value) {
  if (state.clasifActivas.has(value)) state.clasifActivas.delete(value);
  else state.clasifActivas.add(value);

  sincronizarChipsUI();
  aplicarFiltrosYRender();
}

function sincronizarChipsUI() {
  const chips = document.querySelectorAll("#clasifChips .chip");
  chips.forEach((chip) => {
    const value = chip.dataset.value;
    if (state.clasifActivas.has(value)) chip.classList.add("active");
    else chip.classList.remove("active");
  });
  actualizarContadoresChips();
}

function actualizarContadoresChips() {
  const conteos = {};
  rawData.forEach((r) => {
    const c = r.clasificacion || "";
    if (!c) return;
    conteos[c] = (conteos[c] || 0) + 1;
  });

  const chips = document.querySelectorAll("#clasifChips .chip");
  chips.forEach((chip) => {
    const value = chip.dataset.value;
    const span  = chip.querySelector("span");
    span.textContent = (conteos[value] || 0).toLocaleString();
  });
}


