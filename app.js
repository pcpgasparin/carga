import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, orderBy,
  doc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================================================
   CONFIGURAÇÃO — SENHA PARA APAGAR
   ========================================================= */
const SENHA_APAGAR = "pcp"; // 🔑 troque aqui

/* =========================================================
   ESTADO
   ========================================================= */
let dias = [];
let viewAtual = "detalhado";
let filtroData = "";
let unsubscribe = null;

const statusEl = document.getElementById("statusConexao");

/* =========================================================
   HELPERS
   ========================================================= */
const fmtData = (iso) => {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

const diaSemana = (iso) => {
  const dias = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  return dias[new Date(iso + "T00:00:00").getDay()];
};

const hojeISO = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

const formatarPeso = (valor) => {
  return Number(valor || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/* =========================================================
   MODAL DE SENHA
   ========================================================= */
function pedirSenha(titulo, mensagem) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-header">
          <span>🔒 ${titulo}</span>
          <button class="modal-close" type="button" aria-label="Fechar">✕</button>
        </div>
        <div class="modal-body">
          <p class="modal-msg">${mensagem}</p>
          <label class="modal-label">Senha de administrador</label>
          <input type="password" class="modal-input" id="modalSenhaInput" autocomplete="off" autofocus>
          <div class="modal-erro" id="modalErro"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-sec-modal" type="button" data-cancelar>Cancelar</button>
          <button class="btn-danger-modal" type="button" data-confirmar>Confirmar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector("#modalSenhaInput");
    const erroEl = overlay.querySelector("#modalErro");
    const btnCancelar = overlay.querySelector("[data-cancelar]");
    const btnConfirmar = overlay.querySelector("[data-confirmar]");
    const btnFechar = overlay.querySelector(".modal-close");

    setTimeout(() => input.focus(), 50);

    function fechar(resultado) {
      overlay.classList.add("fechando");
      setTimeout(() => {
        overlay.remove();
        resolve(resultado);
      }, 150);
    }

    function tentarConfirmar() {
      if (input.value === SENHA_APAGAR) {
        fechar(true);
      } else {
        erroEl.textContent = "❌ Senha incorreta. Tente novamente.";
        input.value = "";
        input.focus();
        overlay.querySelector(".modal-box").classList.add("shake");
        setTimeout(() => {
          overlay.querySelector(".modal-box").classList.remove("shake");
        }, 400);
      }
    }

    btnConfirmar.addEventListener("click", tentarConfirmar);
    btnCancelar.addEventListener("click", () => fechar(false));
    btnFechar.addEventListener("click", () => fechar(false));

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tentarConfirmar();
      if (e.key === "Escape") fechar(false);
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fechar(false);
    });
  });
}

/* =========================================================
   FIREBASE — LISTENER EM TEMPO REAL
   ========================================================= */
function iniciarListener() {
  if (unsubscribe) unsubscribe();

  statusEl.textContent = "🔄 Conectando...";
  statusEl.className = "status";

  const q = query(collection(db, "cargas"), orderBy("data", "asc"));

  unsubscribe = onSnapshot(q,
    (snap) => {
      dias = snap.docs.map(d => ({
        data: d.id,
        ...d.data()
      }));

      const totalCargas = dias.reduce((acc, d) => acc + (d.cargas?.length || 0), 0);
      const pesoTotal = dias.reduce((acc, d) => acc + (d.pesoLiquido || 0), 0);
      statusEl.textContent = `🔥 Firebase (${dias.length} dia(s) • ${totalCargas} carga(s) • ${formatarPeso(pesoTotal)} kg)`;
      statusEl.className = "status ok";
      render();
    },
    (err) => {
      console.error(err);
      statusEl.textContent = "🔴 Erro de conexão";
      statusEl.className = "status erro";
    }
  );
}

iniciarListener();

document.getElementById("btnAtualizar").addEventListener("click", iniciarListener);

/* =========================================================
   APAGAR DIA
   ========================================================= */
async function apagarDia(dataISO) {
  const dia = dias.find(d => d.data === dataISO);
  if (!dia) return;
  const qtd = dia.cargas?.length || 0;
  if (qtd === 0) return;

  const ok = await pedirSenha(
    "Apagar dia",
    `Você está prestes a apagar TODAS as ${qtd} carga(s) de ${fmtData(dataISO)}. Essa ação não pode ser desfeita.`
  );
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "cargas", dataISO));
  } catch (err) {
    console.error(err);
    alert("❌ Erro ao apagar: " + err.message);
  }
}

/* =========================================================
   LIMPAR DIAS PASSADOS
   ========================================================= */
document.getElementById("btnLimparPassados").addEventListener("click", async () => {
  const hoje = hojeISO();
  const passados = dias.filter(d => d.data < hoje);

  if (passados.length === 0) {
    alert("✅ Não há cargas de dias passados para apagar.");
    return;
  }

  const totalCargas = passados.reduce((acc, d) => acc + (d.cargas?.length || 0), 0);
  const datas = passados.map(d => fmtData(d.data)).sort();

  const ok = await pedirSenha(
    "Limpar dias passados",
    `Você está prestes a apagar ${totalCargas} carga(s) de ${passados.length} dia(s) passado(s): ${datas.join(", ")}.`
  );
  if (!ok) return;

  try {
    const batch = writeBatch(db);
    passados.forEach(d => batch.delete(doc(db, "cargas", d.data)));
    await batch.commit();
  } catch (err) {
    console.error(err);
    alert("❌ Erro ao limpar: " + err.message);
  }
});

/* =========================================================
   FILTRO
   ========================================================= */
document.getElementById("filtroData").addEventListener("change", (e) => {
  filtroData = e.target.value;
  render();
});
document.getElementById("btnLimparFiltro").addEventListener("click", () => {
  filtroData = "";
  document.getElementById("filtroData").value = "";
  render();
});

/* =========================================================
   TABS
   ========================================================= */
document.getElementById("btnDetalhado").addEventListener("click", () => setView("detalhado"));
document.getElementById("btnResumo").addEventListener("click", () => setView("resumo"));

function setView(v) {
  viewAtual = v;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".view").forEach(s => s.classList.remove("active"));
  document.getElementById(v === "detalhado" ? "btnDetalhado" : "btnResumo").classList.add("active");
  document.getElementById(v === "detalhado" ? "viewDetalhado" : "viewResumo").classList.add("active");
  render();
}

/* =========================================================
   FILTRAGEM
   ========================================================= */
function getCargasFiltradas() {
  let lista = [];
  dias.forEach(dia => {
    (dia.cargas || []).forEach(c => {
      lista.push({
        data: dia.data,
        numeroCarga: c.numeroCarga,
        produtos: c.produtos || []
      });
    });
  });

  if (filtroData) lista = lista.filter(c => c.data >= filtroData);

  lista.sort((a, b) =>
    a.data === b.data
      ? String(a.numeroCarga).localeCompare(String(b.numeroCarga), undefined, { numeric: true })
      : a.data.localeCompare(b.data)
  );

  return lista;
}

function render() {
  const lista = getCargasFiltradas();
  viewAtual === "detalhado" ? renderDetalhado(lista) : renderResumo(lista);
}

/* =========================================================
   DETALHADO
   ========================================================= */
function renderDetalhado(lista) {
  const tbody = document.querySelector("#tabelaDetalhado tbody");
  tbody.innerHTML = "";

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="vazio">Nenhuma carga programada.</td></tr>`;
    return;
  }

  const pesoPorData = {};
  dias.forEach(d => { pesoPorData[d.data] = d.pesoLiquido || 0; });

  let dataAnterior = null;

  lista.forEach(carga => {
    const produtos = carga.produtos || [];
    const novaData = carga.data !== dataAnterior;

    const pesoDia = pesoPorData[carga.data] || 0;
    const pesoFmt = pesoDia > 0 ? formatarPeso(pesoDia) : "";

    if (produtos.length === 0) {
      const tr = document.createElement("tr");
      if (novaData) tr.classList.add("grupo-data");
      tr.innerHTML = `
        <td class="data-cell">
          ${novaData ? fmtData(carga.data) + " <small>"+diaSemana(carga.data)+"</small>" : ""}
          ${novaData && pesoFmt ? `<span class="peso-dia">${pesoFmt} kg</span>` : ""}
          ${novaData ? `<button class="btn-del-dia" data-data="${carga.data}" title="Apagar este dia">🗑</button>` : ""}
        </td>
        <td class="carga-cell">${carga.numeroCarga}</td>
        <td colspan="4"><em>Sem produtos</em></td>`;
      tbody.appendChild(tr);
    } else {
      produtos.forEach((p, idx) => {
        const tr = document.createElement("tr");
        if (novaData && idx === 0) tr.classList.add("grupo-data");
        if (idx === 0) tr.classList.add("inicio-carga");

        const btnApagar = (novaData && idx === 0)
          ? `<button class="btn-del-dia" data-data="${carga.data}" title="Apagar este dia">🗑</button>`
          : "";

        tr.innerHTML = `
          <td class="data-cell">
            ${novaData && idx === 0 ? fmtData(carga.data) + " <small>"+diaSemana(carga.data)+"</small>" : ""}
            ${novaData && idx === 0 && pesoFmt ? `<span class="peso-dia">${pesoFmt} kg</span>` : ""}
            ${btnApagar}
          </td>
          <td class="carga-cell">${idx === 0 ? carga.numeroCarga : ""}</td>
          <td>${p.codigo}</td>
          <td>${p.nome}</td>
          <td class="qtd-cell">${Number(p.quantidade).toLocaleString("pt-BR")}</td>
          <td>${p.unidade || ""}</td>`;
        tbody.appendChild(tr);
      });
    }
    dataAnterior = carga.data;
  });

  tbody.querySelectorAll(".btn-del-dia").forEach(btn => {
    btn.addEventListener("click", () => apagarDia(btn.dataset.data));
  });
}

/* =========================================================
   RESUMO
   ========================================================= */
function renderResumo(lista) {
  const container = document.getElementById("cardsResumo");
  container.innerHTML = "";

  if (lista.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhuma carga programada.</div>`;
    return;
  }

  const pesoPorData = {};
  dias.forEach(d => { pesoPorData[d.data] = d.pesoLiquido || 0; });

  const porData = {};
  lista.forEach(c => {
    if (!porData[c.data]) porData[c.data] = { produtos: {}, cargas: [] };
    porData[c.data].cargas.push(c.numeroCarga);
    (c.produtos || []).forEach(p => {
      const chave = `${p.codigo}||${p.nome}||${p.unidade || ""}`;
      if (!porData[c.data].produtos[chave]) {
        porData[c.data].produtos[chave] = {
          codigo: p.codigo, nome: p.nome, unidade: p.unidade, total: 0
        };
      }
      porData[c.data].produtos[chave].total += Number(p.quantidade) || 0;
    });
  });

  Object.keys(porData).sort().forEach(data => {
    const info = porData[data];
    const card = document.createElement("div");
    card.className = "card-dia";

    const produtosHTML = Object.values(info.produtos)
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map(p => `
        <div class="produto-linha">
          <span class="p-nome">
            <small class="p-cod">${p.codigo}</small>
            ${p.nome}
          </span>
          <span class="qtd">${p.total.toLocaleString("pt-BR")} <small>${p.unidade || ""}</small></span>
        </div>`).join("") || `<div class="produto-linha"><em>Sem produtos</em></div>`;

    const cargasHTML = info.cargas
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
      .map(n => `<span class="carga-tag">${n}</span>`)
      .join("");

    const pesoDia = pesoPorData[data] || 0;
    const pesoFmt = pesoDia > 0 ? formatarPeso(pesoDia) + " kg" : "";

    card.innerHTML = `
      <div class="card-header">
        <span>${fmtData(data)} — ${diaSemana(data)}</span>
        <div class="card-header-actions">
          ${pesoFmt ? `<span class="badge-peso">${pesoFmt}</span>` : ""}
          <span class="badge">${info.cargas.length} carga(s)</span>
          <button class="btn-del-dia-card" data-data="${data}" title="Apagar este dia">🗑</button>
        </div>
      </div>
      <div class="card-body">
        ${produtosHTML}
        <div class="cargas-lista">
          <h4>Nº das Cargas</h4>
          <div class="cargas-tags">${cargasHTML}</div>
        </div>
      </div>`;

    container.appendChild(card);
  });

  container.querySelectorAll(".btn-del-dia-card").forEach(btn => {
    btn.addEventListener("click", () => apagarDia(btn.dataset.data));
  });
}