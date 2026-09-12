// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyC56h2z_HnfFH6h0QEqYjOFoUolNwDeJDQ",
    authDomain: "nfc-genesaret.firebaseapp.com",
    projectId: "nfc-genesaret",
    storageBucket: "nfc-genesaret.firebasestorage.app",
    messagingSenderId: "58470602922",
    appId: "1:58470602922:web:661854ac1cc6f11f8c58d3"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistencia en múltiples pestañas restringida.');
  } else if (err.code === 'unimplemented') {
    console.warn('El navegador no soporta persistencia offline.');
  }
});

// --- ESTADO GLOBAL ---
let currentUserData = null;
let currentChipId = null;
let currentChipData = null;
let articuloActivo = null;
let piezasACobrar = 1;
let catalogoArticulos = [];
let historialSesion = [];
let listaChipsCache = [];

// Estados del Admin
let totalEfectivoCajaAdmin = 0;
let ultimasOperacionesAdmin = [];

// Listeners en tiempo real para SuperAdmin
let unsubscribeTransacciones = null;
let unsubscribeChips = null;
let chartProductosRef = null;

// ==========================================
// MÓDULO BÍBLICO (ROTACIÓN CADA 15 MINUTOS)
// ==========================================
const versiculosBiblia = [
  { texto: "Todo lo que hagan, háganlo de corazón, como para el Señor y no para los hombres.", cita: "Colosenses 3:23" },
  { texto: "El que es fiel en lo muy poco, también en lo más es fiel; y el que en lo muy poco es injusto, también en lo más es injusto.", cita: "Lucas 16:10" },
  { texto: "Encomienda al Señor tus obras, y tus proyectos se cumplirán.", cita: "Proverbios 16:3" },
  { texto: "Bendeciré la obra de tus manos, y prestarás a muchos y tú no pedirás prestado.", cita: "Deuteronomio 28:12" },
  { texto: "No nos cansemos, pues, de hacer bien; porque a su tiempo segaremos, si no desmayamos.", cita: "Gálatas 6:9" },
  { texto: "Sean constantes, firmes y creciendo siempre en la obra del Señor, sabiendo que su trabajo no es en vano.", cita: "1 Corintios 15:58" },
  { texto: "La bendición del Señor es la que enriquece, y no añade tristeza con ella.", cita: "Proverbios 10:22" },
  { texto: "El peso falso es abominación al Señor, pero la pesa cabal es su deleite.", cita: "Proverbios 11:1" }
];

let indiceVersiculo = 0;

function actualizarVersiculoEnPantalla() {
  const v = versiculosBiblia[indiceVersiculo % versiculosBiblia.length];
  
  const vTxtVend = document.getElementById('bibliaTextoVendedor');
  const vCitaVend = document.getElementById('bibliaCitaVendedor');
  const vTxtAdm = document.getElementById('bibliaTextoAdmin');
  const vCitaAdm = document.getElementById('bibliaCitaAdmin');

  if (vTxtVend && vCitaVend) {
    vTxtVend.textContent = `"${v.texto}"`;
    vCitaVend.textContent = v.cita;
  }
  if (vTxtAdm && vCitaAdm) {
    vTxtAdm.textContent = `"${v.texto}"`;
    vCitaAdm.textContent = v.cita;
  }

  indiceVersiculo++;
}

actualizarVersiculoEnPantalla();
setInterval(actualizarVersiculoEnPantalla, 15 * 60 * 1000);

// --- DETECCIÓN DE PARÁMETRO URL (?chip=UID) ---
function obtenerChipUrl() {
  const params = new URLSearchParams(window.location.search);
  const chip = params.get('chip');
  return chip ? chip.trim().toUpperCase() : null;
}

// --- CICLO DE VIDA DE AUTENTICACIÓN ---
auth.onAuthStateChanged(async user => {
  if (user) {
    document.getElementById('btnLogout').classList.remove('hidden');
    const userDoc = await db.collection('usuarios').doc(user.uid).get();
    
    if (userDoc.exists) {
      const data = userDoc.data();
      currentUserData = {
        uid: user.uid,
        ...data,
        rol: (data.rol || data.role || 'vendedor').toLowerCase(),
        nombre: data.nombre || data.name || data.email
      };
      actualizarBadgeRol(currentUserData.rol);
      inicializarFlujoPorRol();
    } else {
      Swal.fire('Error', 'Usuario sin perfil registrado en Firestore.', 'error');
      cerrarSesion();
    }
  } else {
    destruirListenersTiempoReal();
    currentUserData = null;
    document.getElementById('btnLogout').classList.add('hidden');
    actualizarBadgeRol('Desconectado');
    ajustarLayoutAncho(false);
    mostrarVista('viewLogin');
  }
});

function actualizarBadgeRol(rol) {
  const badge = document.getElementById('rolBadge');
  badge.textContent = rol.toUpperCase();
  badge.className = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ';
  if (rol === 'superadmin') badge.className += 'bg-purple-900/80 text-purple-300 border border-purple-700/50';
  else if (rol === 'admin') badge.className += 'bg-amber-900/80 text-amber-300 border border-amber-700/50';
  else if (rol === 'vendedor') badge.className += 'bg-blue-900/80 text-blue-300 border border-blue-700/50';
  else badge.className += 'bg-slate-800 text-slate-400';
}

function mostrarVista(viewId) {
  ['viewLogin', 'viewVendedor', 'viewAdmin', 'viewSuperAdmin'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById(viewId).classList.remove('hidden');
}

function ajustarLayoutAncho(esDashboard) {
  const header = document.getElementById('mainHeader');
  const container = document.getElementById('mainContainer');
  const nav = document.getElementById('superadminNav');

  if (esDashboard) {
    header.classList.remove('max-w-md');
    header.classList.add('max-w-6xl');
    container.classList.remove('max-w-md');
    container.classList.add('layout-dashboard');
    
    if (nav) {
      nav.classList.remove('flex');
      nav.classList.add('hidden', 'md:flex');
    }
  } else {
    header.classList.add('max-w-md');
    header.classList.remove('max-w-6xl');
    container.classList.add('max-w-md');
    container.classList.remove('layout-dashboard');
    
    if (nav) {
      nav.classList.add('hidden');
      nav.classList.remove('md:flex');
    }
  }
}

// --- LOGIN / LOGOUT ---
async function ejecutarLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value.trim();
  if (!email || !pass) return Swal.fire('Atención', 'Ingresa usuario y contraseña.', 'warning');

  try {
    Swal.showLoading();
    await auth.signInWithEmailAndPassword(email, pass);
    Swal.close();
  } catch (err) {
    Swal.fire('Error al ingresar', err.message, 'error');
  }
}

function cerrarSesion() {
  destruirListenersTiempoReal();
  auth.signOut().then(() => {
    window.location.search = '';
  });
}

function destruirListenersTiempoReal() {
  if (unsubscribeTransacciones) { unsubscribeTransacciones(); unsubscribeTransacciones = null; }
  if (unsubscribeChips) { unsubscribeChips(); unsubscribeChips = null; }
  if (chartProductosRef) { chartProductosRef.destroy(); chartProductosRef = null; }
  if (unsubscribeChipAdmin) { unsubscribeChipAdmin(); unsubscribeChipAdmin = null; }
}

// --- ENRUTADOR DINÁMICO ---
async function inicializarFlujoPorRol() {
  currentChipId = obtenerChipUrl();

  if (currentUserData.rol === 'superadmin') {
    ajustarLayoutAncho(true);
    document.getElementById('userGreeting').textContent = `Hola, ${currentUserData.nombre}`;
    mostrarVista('viewSuperAdmin');
    switchTabSuperAdmin('dashboard');
    await cargarCatalogo();
    await cargarPersonal();
    iniciarMonitoreoTiempoRealSuperAdmin();
  } else {
    ajustarLayoutAncho(false);
    document.getElementById('userGreeting').textContent = '';

    if (currentUserData.rol === 'admin') {
      mostrarVista('viewAdmin');
      if (currentChipId) {
        document.getElementById('admChipId').textContent = currentChipId;
        await refrescarDatosChipAdmin(currentChipId);
      }
    } else if (currentUserData.rol === 'vendedor') {
      mostrarVista('viewVendedor');
      switchTabVendedor('cobro');
      await cargarCatalogo();
      await cargarArticuloVendedor();
      await cargarHistorialVendedorDesdeFirestore();
      if (currentChipId) {
        await refrescarDatosChipVendedor(currentChipId);
      }
    }
  }
}

// ==========================================
// SECCIÓN: VENDEDOR
// ==========================================
function switchTabVendedor(tab) {
  const tabCobro = document.getElementById('tabContentVendCobro');
  const tabHistorial = document.getElementById('tabContentVendHistorial');
  const btnCobro = document.getElementById('tabBtnVendCobro');
  const btnHistorial = document.getElementById('tabBtnVendHistorial');

  if (tab === 'cobro') {
    tabCobro.classList.remove('hidden');
    tabHistorial.classList.add('hidden');
    btnCobro.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs bg-blue-600 text-white shadow-lg shadow-blue-600/25 btn-action';
    btnHistorial.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs bg-slate-900/80 text-slate-400 border border-slate-800 btn-action';
  } else {
    tabCobro.classList.add('hidden');
    tabHistorial.classList.remove('hidden');
    btnHistorial.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs bg-blue-600 text-white shadow-lg shadow-blue-600/25 btn-action';
    btnCobro.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs bg-slate-900/80 text-slate-400 border border-slate-800 btn-action';
  }
}

async function cargarArticuloVendedor() {
  if (!currentUserData.articuloAsignadoId) {
    document.getElementById('artActivoNombre').textContent = 'Sin producto asignado';
    return;
  }
  const artDoc = await db.collection('articulos').doc(currentUserData.articuloAsignadoId).get();
  if (artDoc.exists) {
    articuloActivo = { id: artDoc.id, ...artDoc.data() };
    document.getElementById('artActivoNombre').textContent = articuloActivo.nombre;
    document.getElementById('artActivoPrecio').textContent = `$${articuloActivo.precio.toFixed(2)}`;
    
    actualizarBadgeStock(articuloActivo.stock);
    calcularTotalVenta();
  }
}

function actualizarBadgeStock(stock) {
  const badge = document.getElementById('badgeStockVendedor');
  const btnCobrar = document.getElementById('btnCobrar');
  if (stock === undefined || stock === null) {
    badge.textContent = 'Stock: Ilimitado';
    badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full badge-stock-ok';
    btnCobrar.disabled = false;
  } else if (stock <= 0) {
    badge.textContent = 'AGOTADO';
    badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full badge-stock-out';
    btnCobrar.disabled = true;
  } else {
    badge.textContent = `Quedan: ${stock}`;
    badge.className = stock <= 10 
      ? 'text-[10px] font-bold px-2 py-0.5 rounded-full badge-stock-low animate-pulse'
      : 'text-[10px] font-bold px-2 py-0.5 rounded-full badge-stock-ok';
    btnCobrar.disabled = false;
  }
}

async function refrescarDatosChipVendedor(chipId) {
  const radarIcon = document.getElementById('vendRadarIcon');
  const statusBadge = document.getElementById('vendChipStatusBadge');
  const panelCobro = document.getElementById('vendPanelCobro');

  const doc = await db.collection('chips').doc(chipId).get();
  if (doc.exists && doc.data().nombre && doc.data().nombre.trim() !== '') {
    currentChipData = doc.data();
    document.getElementById('vendNombre').textContent = currentChipData.nombre;
    document.getElementById('vendSaldo').textContent = `$${(currentChipData.saldoActual || 0).toFixed(2)}`;
    document.getElementById('vendChipId').textContent = `UID: ${chipId}`;

    radarIcon.textContent = '✅';
    radarIcon.className = 'w-12 h-12 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-2xl';
    statusBadge.textContent = 'Pulsera Conectada';
    statusBadge.className = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40';

    if (panelCobro) panelCobro.classList.remove('hidden');
  } else {
    currentChipData = null;
    document.getElementById('vendNombre').textContent = 'Pulsera sin registrar';
    document.getElementById('vendSaldo').textContent = '$0.00';
    document.getElementById('vendChipId').textContent = `UID: ${chipId}`;
    
    radarIcon.textContent = '⚠️';
    radarIcon.className = 'w-12 h-12 rounded-2xl bg-amber-600/20 border border-amber-500/40 flex items-center justify-center text-2xl';
    statusBadge.textContent = 'Requiere alta en taquilla';
    statusBadge.className = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/40';

    if (panelCobro) panelCobro.classList.add('hidden');
    Swal.fire('Pulsera no registrada', 'Esta pulsera aún no cuenta con titular o saldo inicial registrado.', 'info');
  }
}

function ajustarPiezas(cambio) {
  const nuevaCant = piezasACobrar + cambio;
  if (nuevaCant >= 1) {
    fijarPiezas(nuevaCant);
  }
}

function fijarPiezas(cant) {
  piezasACobrar = cant;
  document.getElementById('lblPiezas').textContent = piezasACobrar;

  document.querySelectorAll('.pill-qty').forEach(btn => {
    if (parseInt(btn.textContent) === cant) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  calcularTotalVenta();
}

function calcularTotalVenta() {
  if (!articuloActivo) return;
  const total = articuloActivo.precio * piezasACobrar;
  document.getElementById('lblMontoTotal').textContent = `$${total.toFixed(2)}`;
}

async function abrirModalArticulosExtra() {
  const snap = await db.collection('articulos').get();
  let opciones = '';
  snap.forEach(doc => {
    const data = doc.data();
    opciones += `<option value="${doc.id}">${data.nombre} - $${data.precio.toFixed(2)}</option>`;
  });

  const { value: artId } = await Swal.fire({
    title: 'Cobrar otro producto',
    html: `<select id="swalArtExtra" class="w-full p-2.5 rounded-xl">${opciones}</select>`,
    showCancelButton: true,
    confirmButtonText: 'Seleccionar',
    cancelButtonText: 'Cancelar',
    preConfirm: () => document.getElementById('swalArtExtra').value
  });

  if (artId) {
    const artDoc = await db.collection('articulos').doc(artId).get();
    articuloActivo = { id: artDoc.id, ...artDoc.data() };
    document.getElementById('artActivoNombre').textContent = articuloActivo.nombre + " (Extra)";
    document.getElementById('artActivoPrecio').textContent = `$${articuloActivo.precio.toFixed(2)}`;
    fijarPiezas(1);
  }
}

async function procesarCobro() {
  if (!currentChipId) return Swal.fire('Sin pulsera', 'No se detecta el chip NFC.', 'warning');
  if (!articuloActivo) return Swal.fire('Error', 'No hay artículo asignado.', 'warning');

  const totalCobro = articuloActivo.precio * piezasACobrar;
  const titularActual = currentChipData?.nombre || 'Titular';
  const saldoActualVisible = currentChipData?.saldoActual || 0;

  const { isConfirmed } = await Swal.fire({
    title: '¿Confirmar cobro?',
    html: `
      <div class="text-left bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
        <p class="text-slate-300">Cliente: <b class="text-white">${titularActual}</b></p>
        <p class="text-slate-300">Orden: <b class="text-white">${piezasACobrar}x ${articuloActivo.nombre}</b></p>
        <p class="text-slate-300">Saldo disponible: <b class="text-emerald-400">$${saldoActualVisible.toFixed(2)}</b></p>
        <div class="pt-2 border-t border-slate-800 flex justify-between items-center text-sm">
          <span class="text-slate-400 font-bold uppercase">Total a debitar:</span>
          <span class="text-amber-400 font-black text-xl">$${totalCobro.toFixed(2)}</span>
        </div>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, cobrar',
    cancelButtonText: 'Cancelar'
  });

  if (!isConfirmed) return;

  const chipRef = db.collection('chips').doc(currentChipId);
  const artRef = db.collection('articulos').doc(articuloActivo.id);

  try {
    Swal.showLoading();
    let saldoFinal = 0;
    let titular = '';

    await db.runTransaction(async t => {
      const sfDoc = await t.get(chipRef);
      const artDoc = await t.get(artRef);

      if (!sfDoc.exists) throw new Error('El chip no existe en el sistema.');
      
      const saldoActual = sfDoc.data().saldoActual || 0;
      titular = sfDoc.data().nombre || 'Titular';

      if (saldoActual < totalCobro) {
        throw new Error(`Saldo insuficiente. Disponible: $${saldoActual.toFixed(2)}`);
      }

      if (artDoc.exists && artDoc.data().stock !== undefined && artDoc.data().stock !== null) {
        const stockActual = artDoc.data().stock;
        if (stockActual < piezasACobrar) {
          throw new Error(`¡Stock insuficiente! Solo quedan ${stockActual} piezas.`);
        }
        t.update(artRef, { stock: stockActual - piezasACobrar });
        articuloActivo.stock = stockActual - piezasACobrar;
      }

      saldoFinal = saldoActual - totalCobro;
      t.update(chipRef, {
        saldoActual: saldoFinal,
        ultimaTransaccion: firebase.firestore.FieldValue.serverTimestamp()
      });

      const transaccionRef = db.collection('transacciones').doc();
      t.set(transaccionRef, {
        chipId: currentChipId,
        nombreTitular: titular,
        tipo: 'cargo',
        monto: totalCobro,
        saldoPrevio: saldoActual,
        saldoRestante: saldoFinal,
        vendedorUid: currentUserData.uid,
        vendedorNombre: currentUserData.nombre,
        articulos: [{
          id: articuloActivo.id,
          nombre: articuloActivo.nombre,
          piezas: piezasACobrar,
          precioUnitario: articuloActivo.precio
        }],
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    reproducirSonidoExito();
    await refrescarDatosChipVendedor(currentChipId);
    actualizarBadgeStock(articuloActivo.stock);
    registrarHistorialLocal(articuloActivo.nombre, piezasACobrar, totalCobro);

    fijarPiezas(1);

    const mensajeWA = encodeURIComponent(
      `✨ *Genesaret POS - Comprobante de Consumo* ✨\n` +
      `👤 Titular: ${titular}\n` +
      `🛍️ Detalle: ${piezasACobrar}x ${articuloActivo.nombre}\n` +
      `💵 Total Cobrado: $${totalCobro.toFixed(2)}\n` +
      `💳 Saldo Restante: $${saldoFinal.toFixed(2)}\n` +
      `¡Muchas gracias por tu apoyo!`
    );

    Swal.fire({
      icon: 'success',
      title: '¡Cobro Exitoso!',
      html: `
        <div class="text-left bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-2">
          <p class="text-slate-400 text-xs">Monto Cobrado: <b class="text-white text-sm">$${totalCobro.toFixed(2)}</b></p>
          <p class="text-slate-400 text-xs">Saldo Restante: <b class="text-emerald-400 text-sm">$${saldoFinal.toFixed(2)}</b></p>
          <div class="pt-2">
            <a href="https://wa.me/?text=${mensajeWA}" target="_blank" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-2 transition">
              <span>📲 Enviar Ticket por WhatsApp</span>
            </a>
          </div>
        </div>
      `,
      confirmButtonText: 'Listo'
    });

  } catch (err) {
    reproducirSonidoRechazo();
    Swal.fire('No se pudo cobrar', err.message, 'error');
  }
}

// Cargar transacciones reales del vendedor desde Firestore
async function cargarHistorialVendedorDesdeFirestore() {
  if (!currentUserData || !currentUserData.uid) return;

  try {
    const snap = await db.collection('transacciones')
      .where('vendedorUid', '==', currentUserData.uid)
      .where('tipo', '==', 'cargo')
      .get();

    historialSesion = [];

    snap.forEach(doc => {
      const t = doc.data();
      const horaStr = t.timestamp 
        ? t.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) 
        : 'Reciente';
      
      const detalle = t.articulos && t.articulos.length > 0
        ? `${t.articulos[0].piezas}x ${t.articulos[0].nombre}`
        : 'Consumo';

      historialSesion.push({
        producto: detalle,
        monto: t.monto || 0,
        hora: horaStr,
        timestampMillis: t.timestamp ? t.timestamp.toMillis() : 0
      });
    });

    historialSesion.sort((a, b) => b.timestampMillis - a.timestampMillis);
    renderizarHistorialVendedorUI();
  } catch (err) {
    console.error('Error al recuperar historial del vendedor:', err);
  }
}

function renderizarHistorialVendedorUI() {
  const lista = document.getElementById('historialLista');
  const badgeConteo = document.getElementById('historialConteoTab');
  const badgeTotal = document.getElementById('historialTotalAcumulado');
  const lblOrdenes = document.getElementById('resumenTurnoOrdenes');
  const lblDinero = document.getElementById('resumenTurnoDinero');

  const totalCobrado = historialSesion.reduce((acc, cur) => acc + cur.monto, 0);

  if (badgeConteo) badgeConteo.textContent = historialSesion.length;
  if (badgeTotal) badgeTotal.textContent = `$${totalCobrado.toFixed(2)} cobrado`;
  if (lblOrdenes) lblOrdenes.textContent = historialSesion.length;
  if (lblDinero) lblDinero.textContent = `$${totalCobrado.toFixed(2)}`;

  if (!lista) return;

  if (historialSesion.length === 0) {
    lista.innerHTML = '<div class="text-slate-500 italic text-center py-8">Sin ventas registradas en esta sesión</div>';
    return;
  }

  lista.innerHTML = historialSesion.map(item => `
    <div class="flex justify-between items-center bg-slate-900/80 p-3 rounded-xl border border-slate-800">
      <div>
        <span class="font-bold text-white text-sm">${item.producto}</span>
        <span class="block text-[11px] text-slate-500 font-mono mt-0.5">${item.hora}</span>
      </div>
      <span class="font-extrabold text-amber-400 text-sm">-$${item.monto.toFixed(2)}</span>
    </div>
  `).join('');
}

function registrarHistorialLocal(producto, cant, monto) {
  historialSesion.unshift({ 
    producto: `${cant}x ${producto}`, 
    monto: monto, 
    hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timestampMillis: Date.now()
  });

  renderizarHistorialVendedorUI();
}

// ==========================================
// SECCIÓN: ADMIN (TAQUILLA / SALDO)
// ==========================================
let unsubscribeChipAdmin = null;

async function refrescarDatosChipAdmin(chipId) {
  const boxNoReg = document.getElementById('admBoxNoRegistrado');
  const boxReg = document.getElementById('admBoxRegistrado');

  if (unsubscribeChipAdmin) {
    unsubscribeChipAdmin();
    unsubscribeChipAdmin = null;
  }

  unsubscribeChipAdmin = db.collection('chips').doc(chipId).onSnapshot(doc => {
    if (doc.exists && doc.data().nombre && doc.data().nombre.trim() !== '') {
      currentChipData = doc.data();
      document.getElementById('admChipNombre').textContent = currentChipData.nombre;
      document.getElementById('admSubEstado').textContent = 'Pulsera activa y lista para operar';
      document.getElementById('admChipSaldo').textContent = `$${(currentChipData.saldoActual || 0).toFixed(2)}`;

      if (boxNoReg) boxNoReg.classList.add('hidden');
      if (boxReg) boxReg.classList.remove('hidden');
    } else {
      currentChipData = doc.exists ? doc.data() : null;
      document.getElementById('admChipNombre').textContent = 'Sin titular registrado';
      document.getElementById('admSubEstado').textContent = 'Requiere registro inicial antes de recargar';
      document.getElementById('admChipSaldo').textContent = `$${(currentChipData?.saldoActual || 0).toFixed(2)}`;

      if (boxNoReg) boxNoReg.classList.remove('hidden');
      if (boxReg) boxReg.classList.add('hidden');
    }
  });
}

async function recargarMontoRapido(monto) {
  if (!currentChipId) {
    return Swal.fire('Sin pulsera', 'Acerca o escanea primero una pulsera NFC.', 'warning');
  }

  const { isConfirmed } = await Swal.fire({
    title: `¿Recargar +$${monto}.00?`,
    text: `Se abonará al titular ${document.getElementById('admChipNombre').textContent}`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: `Sí, recibir $${monto}`,
    cancelButtonText: 'Cancelar'
  });

  if (!isConfirmed) return;

  const chipRef = db.collection('chips').doc(currentChipId);

  try {
    Swal.showLoading();
    let saldoResultante = 0;
    let titularDoc = 'Sin nombre';

    await db.runTransaction(async t => {
      const sfDoc = await t.get(chipRef);
      const saldoActual = sfDoc.exists ? (sfDoc.data().saldoActual || 0) : 0;
      titularDoc = sfDoc.exists ? (sfDoc.data().nombre || 'Sin nombre') : 'Nuevo Titular';
      saldoResultante = saldoActual + monto;

      t.set(chipRef, {
        saldoActual: saldoResultante,
        ultimaTransaccion: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const tRef = db.collection('transacciones').doc();
      t.set(tRef, {
        chipId: currentChipId,
        nombreTitular: titularDoc,
        tipo: 'recarga',
        monto: monto,
        saldoPrevio: saldoActual,
        saldoRestante: saldoResultante,
        vendedorUid: currentUserData.uid,
        vendedorNombre: currentUserData.nombre,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    document.getElementById('admChipSaldo').textContent = `$${saldoResultante.toFixed(2)}`;

    totalEfectivoCajaAdmin += monto;
    document.getElementById('admTotalCajaEfectivo').textContent = `$${totalEfectivoCajaAdmin.toFixed(2)}`;

    ultimasOperacionesAdmin.unshift({
      titular: titularDoc,
      monto: monto,
      hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    actualizarTiraOperacionesAdmin();
    reproducirSonidoExito();

    Swal.fire({
      icon: 'success',
      title: '¡Recarga Exitosa!',
      text: `Saldo nuevo: $${saldoResultante.toFixed(2)}`,
      timer: 1500,
      showConfirmButton: false
    });

  } catch (err) {
    reproducirSonidoRechazo();
    Swal.fire('Error al recargar', err.message, 'error');
  }
}

function actualizarTiraOperacionesAdmin() {
  const box = document.getElementById('admUltimasOperaciones');
  box.innerHTML = ultimasOperacionesAdmin.slice(0, 3).map(op => `
    <div class="bg-slate-900/90 p-2 rounded-xl border border-slate-800 flex justify-between items-center">
      <div>
        <span class="font-bold text-white text-xs block">${op.titular}</span>
        <span class="text-[10px] text-slate-500 font-mono">${op.hora}</span>
      </div>
      <span class="font-black text-emerald-400 text-xs">+$${op.monto.toFixed(2)}</span>
    </div>
  `).join('');
}

async function abrirModalRegistroNFC() {
  if (!currentChipId) return Swal.fire('Atención', 'Abre el sistema con un chip escaneado.', 'warning');

  const { value: formValues } = await Swal.fire({
    title: 'Registrar Titular y Saldo',
    html: `
      <input id="swalTitular" class="w-full p-2.5 rounded-xl mb-2" placeholder="Nombre completo" value="${currentChipData?.nombre || ''}">
      <input id="swalSaldoInicial" type="number" class="w-full p-2.5 rounded-xl" placeholder="Saldo inicial ($)" value="0">
    `,
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const nombre = document.getElementById('swalTitular').value.trim();
      const saldo = parseFloat(document.getElementById('swalSaldoInicial').value);
      if (!nombre) return Swal.showValidationMessage('El nombre es requerido.');
      if (isNaN(saldo) || saldo < 0) return Swal.showValidationMessage('Ingresa un monto válido.');
      return { nombre, saldo };
    }
  });

  if (formValues) {
    try {
      Swal.showLoading();
      await db.runTransaction(async t => {
        const ref = db.collection('chips').doc(currentChipId);
        t.set(ref, {
          nombre: formValues.nombre,
          saldoActual: formValues.saldo,
          ultimaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        if (formValues.saldo > 0) {
          const tRef = db.collection('transacciones').doc();
          t.set(tRef, {
            chipId: currentChipId,
            nombreTitular: formValues.nombre,
            tipo: 'recarga',
            monto: formValues.saldo,
            saldoPrevio: 0,
            saldoRestante: formValues.saldo,
            vendedorUid: currentUserData.uid,
            vendedorNombre: currentUserData.nombre,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      });

      if (formValues.saldo > 0) {
        totalEfectivoCajaAdmin += formValues.saldo;
        document.getElementById('admTotalCajaEfectivo').textContent = `$${totalEfectivoCajaAdmin.toFixed(2)}`;
        ultimasOperacionesAdmin.unshift({
          titular: formValues.nombre,
          monto: formValues.saldo,
          hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        actualizarTiraOperacionesAdmin();
      }

      await refrescarDatosChipAdmin(currentChipId);
      Swal.fire('Guardado', 'Chip configurado correctamente.', 'success');
    } catch (e) {
      Swal.fire('Error', e.message, 'error');
    }
  }
}

async function abrirModalAjusteSaldo() {
  if (!currentChipId) return Swal.fire('Atención', 'Abre el sistema con un chip escaneado.', 'warning');

  const { value: formValues } = await Swal.fire({
    title: 'Ajustar Saldo',
    html: `
      <select id="swalTipoAjuste" class="w-full p-2.5 rounded-xl mb-2">
        <option value="recarga">➕ Agregar Saldo (Recarga)</option>
        <option value="restar">➖ Restar Saldo</option>
      </select>
      <input id="swalMontoAjuste" type="number" step="any" class="w-full p-2.5 rounded-xl" placeholder="Monto ($)">
    `,
    showCancelButton: true,
    confirmButtonText: 'Aplicar',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const tipo = document.getElementById('swalTipoAjuste').value;
      const monto = parseFloat(document.getElementById('swalMontoAjuste').value);
      if (isNaN(monto) || monto <= 0) return Swal.showValidationMessage('Monto no válido.');
      return { tipo, monto };
    }
  });

  if (formValues) {
    const chipRef = db.collection('chips').doc(currentChipId);
    try {
      Swal.showLoading();
      await db.runTransaction(async t => {
        const sfDoc = await t.get(chipRef);
        if (!sfDoc.exists) throw new Error('El chip no está registrado.');
        
        const saldoActual = sfDoc.data().saldoActual || 0;
        let nuevoSaldo = saldoActual;

        if (formValues.tipo === 'recarga') {
          nuevoSaldo += formValues.monto;
        } else {
          if (saldoActual < formValues.monto) throw new Error('Saldo insuficiente para restar.');
          nuevoSaldo -= formValues.monto;
        }

        t.update(chipRef, { 
          saldoActual: nuevoSaldo,
          ultimaActualizacion: firebase.firestore.FieldValue.serverTimestamp()
        });

        const tRef = db.collection('transacciones').doc();
        t.set(tRef, {
          chipId: currentChipId,
          nombreTitular: sfDoc.data().nombre || 'Sin nombre',
          tipo: formValues.tipo,
          monto: formValues.monto,
          saldoPrevio: saldoActual,
          saldoRestante: nuevoSaldo,
          vendedorUid: currentUserData.uid,
          vendedorNombre: currentUserData.nombre,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      if (formValues.tipo === 'recarga') {
        totalEfectivoCajaAdmin += formValues.monto;
        document.getElementById('admTotalCajaEfectivo').textContent = `$${totalEfectivoCajaAdmin.toFixed(2)}`;
      }

      await refrescarDatosChipAdmin(currentChipId);
      Swal.fire('Completado', 'Saldo modificado con éxito.', 'success');
    } catch (e) {
      Swal.fire('Error', e.message, 'error');
    }
  }
}

function consultarChipActual() {
  if (!currentChipId) return Swal.fire('Consulta', 'No hay chip escaneado.', 'info');
  Swal.fire({
    title: 'Información del Chip',
    html: `
      <div class="text-left bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-2">
        <p class="text-slate-400 text-xs font-mono">UID: ${currentChipId}</p>
        <p class="text-white text-base">Titular: <b>${document.getElementById('admChipNombre').textContent}</b></p>
        <p class="text-emerald-400 text-2xl font-black">Saldo: ${document.getElementById('admChipSaldo').textContent}</p>
      </div>
    `,
    confirmButtonText: 'Cerrar'
  });
}

// ==========================================
// SECCIÓN: SUPER ADMIN & MONITOR EN VIVO
// ==========================================
function switchTabSuperAdmin(tab) {
  ['tabContentDashboard', 'tabContentChips', 'tabContentArticulos', 'tabContentUsuarios', 'tabContentReportes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  ['tabNavDashboard', 'tabNavChips', 'tabNavArticulos', 'tabNavUsuarios', 'tabNavReportes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition';
  });

  ['tabBtnDashboard', 'tabBtnChips', 'tabBtnArticulos', 'tabBtnUsuarios', 'tabBtnReportes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'py-2.5 px-1 rounded-xl font-bold text-[11px] bg-slate-900/90 text-slate-400 border border-slate-800 text-center truncate transition';
  });

  const activeContent = document.getElementById(`tabContent${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
  const activeNav = document.getElementById(`tabNav${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
  const activeBtnMobile = document.getElementById(`tabBtn${tab.charAt(0).toUpperCase() + tab.slice(1)}`);

  if (activeContent) activeContent.classList.remove('hidden');
  if (activeNav) activeNav.className = 'px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30';
  if (activeBtnMobile) activeBtnMobile.className = 'py-2.5 px-1 rounded-xl font-bold text-[11px] bg-blue-600 text-white text-center truncate shadow-sm transition';
}

function iniciarMonitoreoTiempoRealSuperAdmin() {
  destruirListenersTiempoReal();

  unsubscribeTransacciones = db.collection('transacciones').orderBy('timestamp', 'desc')
    .onSnapshot(snapshot => {
      let totalRecargas = 0;
      let totalVentas = 0;
      let conteoOps = snapshot.size;
      const ventasPorArticulo = {};
      const ultimasTransacciones = [];

      snapshot.forEach(doc => {
        const t = doc.data();
        const monto = t.monto || 0;

        if (t.tipo === 'recarga') {
          totalRecargas += monto;
        } else if (t.tipo === 'cargo') {
          totalVentas += monto;
          if (t.articulos && Array.isArray(t.articulos)) {
            t.articulos.forEach(art => {
              ventasPorArticulo[art.nombre] = (ventasPorArticulo[art.nombre] || 0) + art.piezas;
            });
          }
        }

        if (ultimasTransacciones.length < 15) {
          ultimasTransacciones.push(t);
        }
      });

      document.getElementById('kpiTotalRecargado').textContent = `$${totalRecargas.toFixed(2)}`;
      document.getElementById('kpiTotalGastado').textContent = `$${totalVentas.toFixed(2)}`;
      document.getElementById('kpiConteoTransacciones').textContent = conteoOps;

      const tvRec = document.getElementById('tvKpiRecargas');
      const tvVen = document.getElementById('tvKpiVentas');
      const tvTick = document.getElementById('tvTickerTexto');
      
      if (tvRec) tvRec.textContent = `$${totalRecargas.toFixed(2)}`;
      if (tvVen) tvVen.textContent = `$${totalVentas.toFixed(2)}`;
      if (tvTick && ultimasTransacciones.length > 0) {
        const last = ultimasTransacciones[0];
        tvTick.textContent = `${last.nombreTitular} • ${last.tipo.toUpperCase()} de $${last.monto.toFixed(2)}`;
      }

      renderizarFeedEnVivo(ultimasTransacciones);
      renderizarGraficaTopProductos(ventasPorArticulo);
    });

  unsubscribeChips = db.collection('chips').onSnapshot(snapshot => {
    listaChipsCache = [];
    let saldoFlotanteTotal = 0;

    snapshot.forEach(doc => {
      const data = { id: doc.id, ...doc.data() };
      saldoFlotanteTotal += (data.saldoActual || 0);
      listaChipsCache.push(data);
    });

    document.getElementById('kpiSaldoFlotante').textContent = `$${saldoFlotanteTotal.toFixed(2)}`;
    const tvFlot = document.getElementById('tvKpiFlotante');
    if (tvFlot) tvFlot.textContent = `$${saldoFlotanteTotal.toFixed(2)}`;

    document.getElementById('totalChipsBadge').textContent = `${snapshot.size} pulseras activas`;
    renderizarTablaChips(listaChipsCache);
  });
}

let tvIntervalReloj = null;

function abrirModoPresentacionTV() {
  const modal = document.getElementById('tvPresentationModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const reloj = document.getElementById('tvRelojVivo');
  if (reloj) reloj.textContent = new Date().toLocaleTimeString();

  tvIntervalReloj = setInterval(() => {
    if (reloj) reloj.textContent = new Date().toLocaleTimeString();
  }, 1000);

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function cerrarModoPresentacionTV() {
  const modal = document.getElementById('tvPresentationModal');
  if (!modal) return;
  modal.classList.add('hidden');
  
  if (tvIntervalReloj) {
    clearInterval(tvIntervalReloj);
    tvIntervalReloj = null;
  }
  
  if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function renderizarFeedEnVivo(transacciones) {
  const feed = document.getElementById('feedTransacciones');
  if (!feed) return;

  if (transacciones.length === 0) {
    feed.innerHTML = '<div class="text-slate-500 text-center py-8 italic">Sin transacciones registradas</div>';
    return;
  }

  feed.innerHTML = transacciones.map(t => {
    const esRecarga = t.tipo === 'recarga';
    const color = esRecarga ? 'text-emerald-400' : 'text-amber-400';
    const signo = esRecarga ? '+' : '-';
    const detalle = esRecarga ? 'Recarga de Saldo' : (t.articulos ? t.articulos.map(a => `${a.piezas}x ${a.nombre}`).join(', ') : 'Consumo');

    return `
      <div class="flex justify-between items-center bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
        <div>
          <span class="font-bold text-white text-xs block">${t.nombreTitular || 'Anónimo'}</span>
          <span class="text-[10px] text-slate-400">${detalle}</span>
        </div>
        <span class="font-black text-sm ${color}">${signo}$${t.monto.toFixed(2)}</span>
      </div>
    `;
  }).join('');
}

function renderizarGraficaTopProductos(dataObj) {
  const canvas = document.getElementById('chartTopProductos');
  if (!canvas) return;

  const labels = Object.keys(dataObj);
  const data = Object.values(dataObj);

  if (chartProductosRef) {
    chartProductosRef.data.labels = labels;
    chartProductosRef.data.datasets[0].data = data;
    chartProductosRef.update();
  } else {
    const ctx = canvas.getContext('2d');
    chartProductosRef = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Piezas Vendidas',
          data: data,
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8', font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8', precision: 0 }
          }
        }
      }
    });
  }
}

// --- PULSERAS NFC EN TARJETAS ---
function renderizarTablaChips(chips) {
  const container = document.getElementById('gridChipsCards');
  if (!container) return;
  container.innerHTML = '';

  if (chips.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-12 text-slate-500 italic">No se encontraron pulseras registradas.</div>`;
    return;
  }

  chips.forEach(chip => {
    container.innerHTML += `
      <div class="item-card rounded-2xl p-5 flex flex-col justify-between space-y-4">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl avatar-chip flex items-center justify-center text-lg">
              🎟️
            </div>
            <div>
              <h4 class="font-bold text-white text-sm leading-snug">${chip.nombre || 'Sin registrar'}</h4>
              <span class="font-mono text-[11px] text-blue-400">${chip.id}</span>
            </div>
          </div>
        </div>

        <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 flex justify-between items-center">
          <span class="text-xs text-slate-400">Saldo Actual</span>
          <span class="text-lg font-black text-emerald-400">$${(chip.saldoActual || 0).toFixed(2)}</span>
        </div>

        <button onclick="auditarChip('${chip.id}')" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-xl text-xs font-bold btn-action border border-slate-700/80 flex items-center justify-center gap-2">
          <span>🔍 Consultar Movimientos</span>
        </button>
      </div>
    `;
  });
}

function filtrarTablaChips() {
  const query = document.getElementById('buscadorChips').value.toLowerCase().trim();
  const filtrados = listaChipsCache.filter(c => 
    c.id.toLowerCase().includes(query) || (c.nombre && c.nombre.toLowerCase().includes(query))
  );
  renderizarTablaChips(filtrados);
}

async function auditarChip(chipId) {
  try {
    Swal.showLoading();
    const snap = await db.collection('transacciones')
      .where('chipId', '==', chipId)
      .get();
    
    let docs = [];
    snap.forEach(doc => docs.push(doc.data()));

    docs.sort((a, b) => {
      const timeA = a.timestamp ? a.timestamp.toMillis() : 0;
      const timeB = b.timestamp ? b.timestamp.toMillis() : 0;
      return timeB - timeA;
    });

    let htmlContent = `
      <div class="text-left space-y-2 max-h-72 overflow-y-auto pr-1">
        <div class="text-xs text-slate-400 mb-2">Historial de auditoría para el chip: <b class="font-mono text-white">${chipId}</b></div>
    `;

    if (docs.length === 0) {
      htmlContent += `<div class="text-center py-4 text-slate-500 italic text-xs">Sin transacciones registradas para este chip.</div>`;
    } else {
      docs.forEach(t => {
        const fecha = t.timestamp ? t.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const esRecarga = t.tipo === 'recarga';
        htmlContent += `
          <div class="p-2.5 rounded-xl border border-slate-800 bg-slate-900/80 flex justify-between items-center text-xs">
            <div>
              <span class="font-bold text-white uppercase">${t.tipo}</span>
              <span class="block text-[10px] text-slate-400">${fecha} • Por: ${t.vendedorNombre || 'Admin'}</span>
            </div>
            <span class="font-black ${esRecarga ? 'text-emerald-400' : 'text-amber-400'} text-sm">
              ${esRecarga ? '+' : '-'}$${t.monto.toFixed(2)}
            </span>
          </div>
        `;
      });
    }

    htmlContent += `</div>`;

    Swal.fire({
      title: 'Auditoría de Pulsera',
      html: htmlContent,
      confirmButtonText: 'Cerrar'
    });
  } catch (err) {
    Swal.fire('Error', 'No se pudo cargar el historial: ' + err.message, 'error');
  }
}

// --- PERSONAL EN TARJETAS ---
async function cargarPersonal() {
  const container = document.getElementById('gridUsuariosCards');
  if (!container) return;
  const snap = await db.collection('usuarios').get();
  container.innerHTML = '';
  document.getElementById('totalUsuariosBadge').textContent = `${snap.size} cuentas registradas`;

  snap.forEach(doc => {
    const u = doc.data();
    const rol = (u.rol || u.role || 'vendedor').toLowerCase();
    const artNombre = catalogoArticulos.find(a => a.id === u.articuloAsignadoId)?.nombre || 'Sin producto';

    container.innerHTML += `
      <div class="item-card rounded-2xl p-5 flex flex-col justify-between space-y-4">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl avatar-user flex items-center justify-center text-lg">
              👤
            </div>
            <div>
              <h4 class="font-bold text-white text-sm leading-snug">${u.nombre || u.name || 'Sin nombre'}</h4>
              <span class="font-mono text-[11px] text-slate-400 truncate block max-w-[170px]">${u.email}</span>
            </div>
          </div>
          <button onclick="eliminarUsuario('${doc.id}')" class="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-950/30 transition" title="Eliminar">
            🗑️
          </button>
        </div>

        <div class="space-y-2 pt-2 border-t border-slate-800/80 text-xs">
          <div class="flex justify-between items-center">
            <span class="text-slate-400">Rol de Acceso:</span>
            <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider badge-role-${rol}">
              ${rol}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-slate-400">Puesto / Producto:</span>
            <span class="font-semibold text-slate-200">${artNombre}</span>
          </div>
        </div>
      </div>
    `;
  });
}

async function abrirModalCrearUsuario() {
  let opcionesArt = '<option value="">-- Sin artículo asignado --</option>';
  catalogoArticulos.forEach(art => {
    opcionesArt += `<option value="${art.id}">${art.nombre} ($${art.precio.toFixed(2)})</option>`;
  });

  const { value: formValues } = await Swal.fire({
    title: 'Registrar Usuario',
    html: `
      <input id="swalUserNombre" class="w-full p-2.5 rounded-xl mb-2" placeholder="Nombre completo">
      <input id="swalUserEmail" type="email" class="w-full p-2.5 rounded-xl mb-2" placeholder="Correo electrónico">
      <input id="swalUserPass" type="password" class="w-full p-2.5 rounded-xl mb-2" placeholder="Contraseña (mínimo 6)">
      <select id="swalUserRol" class="w-full p-2.5 rounded-xl mb-2">
        <option value="vendedor">Vendedor</option>
        <option value="admin">Administrador (Taquilla)</option>
        <option value="superadmin">Super Admin</option>
      </select>
      <select id="swalUserArticulo" class="w-full p-2.5 rounded-xl">${opcionesArt}</select>
    `,
    showCancelButton: true,
    confirmButtonText: 'Crear Usuario',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const nombre = document.getElementById('swalUserNombre').value.trim();
      const email = document.getElementById('swalUserEmail').value.trim();
      const pass = document.getElementById('swalUserPass').value.trim();
      const rol = document.getElementById('swalUserRol').value;
      const artId = document.getElementById('swalUserArticulo').value;
      if (!nombre || !email || pass.length < 6) return Swal.showValidationMessage('Completa todos los campos requeridos.');
      return { nombre, email, pass, rol, artId };
    }
  });

  if (formValues) {
    try {
      Swal.showLoading();
      const secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryTemp");
      const cred = await secondaryApp.auth().createUserWithEmailAndPassword(formValues.email, formValues.pass);
      
      await db.collection('usuarios').doc(cred.user.uid).set({
        nombre: formValues.nombre,
        email: formValues.email,
        rol: formValues.rol,
        articuloAsignadoId: formValues.artId || null,
        creadoEl: firebase.firestore.FieldValue.serverTimestamp()
      });

      await secondaryApp.auth().signOut();
      secondaryApp.delete();

      await cargarPersonal();
      Swal.fire('Registrado', 'Usuario creado en el sistema.', 'success');
    } catch (e) {
      Swal.fire('Error', e.message, 'error');
    }
  }
}

async function eliminarUsuario(uid) {
  const { isConfirmed } = await Swal.fire({
    title: '¿Eliminar usuario?',
    text: 'Se removerá de Firestore.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar'
  });

  if (isConfirmed) {
    await db.collection('usuarios').doc(uid).delete();
    await cargarPersonal();
  }
}

// --- CATÁLOGO DE ARTÍCULOS CON EDICIÓN ---
async function cargarCatalogo() {
  const tbody = document.getElementById('listaArticulosTabla');
  if (!tbody) return;
  const snap = await db.collection('articulos').get();
  catalogoArticulos = [];
  tbody.innerHTML = '';

  snap.forEach(doc => {
    const art = { id: doc.id, ...doc.data() };
    catalogoArticulos.push(art);
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/40">
        <td class="py-3 px-3 font-semibold text-white">${art.nombre}</td>
        <td class="py-3 px-3 text-emerald-400 font-bold">$${art.precio.toFixed(2)}</td>
        <td class="py-3 px-3 text-right space-x-1">
          <button onclick="editarArticulo('${art.id}', '${art.nombre.replace(/'/g, "\\'")}', ${art.precio})" class="text-blue-400 hover:text-blue-300 p-2 rounded-lg hover:bg-blue-950/40 transition" title="Editar">
            ✏️
          </button>
          <button onclick="eliminarArticulo('${art.id}')" class="text-red-400 hover:text-red-300 p-2 rounded-lg hover:bg-red-950/40 transition" title="Eliminar">
            🗑️
          </button>
        </td>
      </tr>
    `;
  });
}

async function editarArticulo(id, nombreActual, precioActual) {
  const artDoc = await db.collection('articulos').doc(id).get();
  const stockActual = artDoc.data()?.stock ?? '';

  const { value: formValues } = await Swal.fire({
    title: 'Editar Artículo',
    html: `
      <div class="text-left space-y-3">
        <div>
          <label class="text-xs text-slate-400 font-semibold block mb-1">Nombre</label>
          <input id="editArtNombre" class="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white" value="${nombreActual}">
        </div>
        <div>
          <label class="text-xs text-slate-400 font-semibold block mb-1">Precio Unitario ($)</label>
          <input id="editArtPrecio" type="number" step="0.5" class="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white" value="${precioActual}">
        </div>
        <div>
          <label class="text-xs text-slate-400 font-semibold block mb-1">Stock Disponible (Vacío = Ilimitado)</label>
          <input id="editArtStock" type="number" class="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white" value="${stockActual}">
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Guardar Cambios',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const nombre = document.getElementById('editArtNombre').value.trim();
      const precio = parseFloat(document.getElementById('editArtPrecio').value);
      const stockVal = document.getElementById('editArtStock').value.trim();
      const stock = stockVal !== '' ? parseInt(stockVal) : null;
      if (!nombre || isNaN(precio) || precio <= 0) return Swal.showValidationMessage('Datos no válidos.');
      return { nombre, precio, stock };
    }
  });

  if (formValues) {
    try {
      Swal.showLoading();
      await db.collection('articulos').doc(id).update({
        nombre: formValues.nombre,
        precio: formValues.precio,
        stock: formValues.stock,
        modificadoEl: firebase.firestore.FieldValue.serverTimestamp()
      });
      await cargarCatalogo();
      Swal.fire('Actualizado', 'Artículo modificado con éxito.', 'success');
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }
}

async function abrirModalCrearArticulo() {
  const { value: formValues } = await Swal.fire({
    title: 'Nuevo Artículo',
    html: `
      <input id="swalArtNombre" class="w-full p-2.5 rounded-xl mb-2 bg-slate-900 border border-slate-700 text-white" placeholder="Nombre (Ej. Tacos de Pastor)">
      <input id="swalArtPrecio" type="number" step="0.5" class="w-full p-2.5 rounded-xl mb-2 bg-slate-900 border border-slate-700 text-white" placeholder="Precio ($)">
      <input id="swalArtStock" type="number" class="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white" placeholder="Stock inicial (Opcional, vacío = ilimitado)">
    `,
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
    preConfirm: () => {
      const nombre = document.getElementById('swalArtNombre').value.trim();
      const precio = parseFloat(document.getElementById('swalArtPrecio').value);
      const stockVal = document.getElementById('swalArtStock').value.trim();
      const stock = stockVal !== '' ? parseInt(stockVal) : null;
      if (!nombre || isNaN(precio) || precio <= 0) return Swal.showValidationMessage('Ingresa nombre y precio válido.');
      return { nombre, precio, stock };
    }
  });

  if (formValues) {
    await db.collection('articulos').add({
      nombre: formValues.nombre,
      precio: formValues.precio,
      stock: formValues.stock,
      activo: true,
      creadoEl: firebase.firestore.FieldValue.serverTimestamp()
    });
    await cargarCatalogo();
  }
}

async function eliminarArticulo(id) {
  const { isConfirmed } = await Swal.fire({
    title: '¿Eliminar artículo?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar'
  });

  if (isConfirmed) {
    await db.collection('articulos').doc(id).delete();
    await cargarCatalogo();
  }
}

// ==========================================
// EXPORTACIÓN DE REPORTES EXCEL
// ==========================================
async function descargarReporteGeneralExcel() {
  try {
    Swal.showLoading();
    const snap = await db.collection('transacciones').orderBy('timestamp', 'desc').get();
    const filas = [];

    snap.forEach(doc => {
      const d = doc.data();
      filas.push({
        "ID": doc.id,
        "Fecha / Hora": d.timestamp ? d.timestamp.toDate().toLocaleString() : 'N/A',
        "Chip UID": d.chipId,
        "Titular": d.nombreTitular || 'N/A',
        "Tipo": (d.tipo || '').toUpperCase(),
        "Monto ($)": d.monto,
        "Saldo Previo ($)": d.saldoPrevio || 0,
        "Saldo Restante ($)": d.saldoRestante || 0,
        "Operador": d.vendedorNombre || d.vendedorUid,
        "Detalle": d.articulos ? d.articulos.map(a => `${a.piezas}x ${a.nombre}`).join(', ') : 'Recarga'
      });
    });

    generarArchivoExcel(filas, "Arqueo_Transacciones");
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

async function descargarReporteChipsExcel() {
  try {
    Swal.showLoading();
    const snap = await db.collection('chips').get();
    const filas = [];

    snap.forEach(doc => {
      const d = doc.data();
      filas.push({
        "Chip UID": doc.id,
        "Titular": d.nombre || 'Sin registrar',
        "Saldo Flotante ($)": d.saldoActual || 0,
        "Última Transacción": d.ultimaTransaccion ? d.ultimaTransaccion.toDate().toLocaleString() : 'N/A'
      });
    });

    generarArchivoExcel(filas, "Saldo_Flotante_Chips");
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

async function descargarReporteVendedoresExcel() {
  try {
    Swal.showLoading();
    const snap = await db.collection('transacciones').where('tipo', '==', 'cargo').get();
    const ventasPorVendedor = {};

    snap.forEach(doc => {
      const d = doc.data();
      const vend = d.vendedorNombre || 'Sin asignar';
      if (!ventasPorVendedor[vend]) ventasPorVendedor[vend] = { total: 0, transacciones: 0 };
      ventasPorVendedor[vend].total += d.monto;
      ventasPorVendedor[vend].transacciones += 1;
    });

    const filas = Object.keys(ventasPorVendedor).map(v => ({
      "Vendedor / Puesto": v,
      "Total Recaudado ($)": ventasPorVendedor[v].total,
      "Número de Cobros": ventasPorVendedor[v].transacciones
    }));

    generarArchivoExcel(filas, "Ventas_Por_Vendedor");
  } catch (err) {
    Swal.fire('Error', err.message, 'error');
  }
}

function generarArchivoExcel(datos, prefijo) {
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Datos");
  XLSX.writeFile(wb, `${prefijo}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  Swal.close();
}

async function ejecutarReseteoDePruebas() {
  const { value: confirmacion } = await Swal.fire({
    title: '¿Reiniciar sistema a cero?',
    text: 'Esta acción borrará todas las transacciones y eliminará todas las pulseras de prueba. Escribe "REINICIAR" para confirmar.',
    input: 'text',
    inputPlaceholder: 'REINICIAR',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, borrar todo',
    cancelButtonText: 'Cancelar',
    preConfirm: (val) => {
      if (val !== 'REINICIAR') {
        Swal.showValidationMessage('Debes escribir exactamente "REINICIAR"');
      }
      return val;
    }
  });

  if (confirmacion === 'REINICIAR') {
    try {
      Swal.showLoading();

      const snapTrans = await db.collection('transacciones').get();
      const batch1 = db.batch();
      snapTrans.forEach(doc => batch1.delete(doc.ref));
      await batch1.commit();

      const snapChips = await db.collection('chips').get();
      const batch2 = db.batch();
      snapChips.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();

      Swal.fire({
        icon: 'success',
        title: '¡Sistema en Cero!',
        text: 'Se han eliminado todas las transacciones y chips de prueba.',
        confirmButtonText: 'Excelente'
      });

    } catch (err) {
      Swal.fire('Error al purgar', err.message, 'error');
    }
  }
}

function reproducirSonidoExito() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  } catch (e) { }
}

function reproducirSonidoRechazo() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    osc.frequency.setValueAtTime(180, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
    if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
  } catch (e) { }
}