import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, setDoc, getDocs,
  deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* =========================================================
   CONFIGURAÇÃO — SENHA PARA AÇÕES CRÍTICAS
   ========================================================= */
const SENHA_ADMIN = "pcp"; // 🔑 troque aqui

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
      if (input.value === SENHA_ADMIN) {
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
   ESTADO
   ========================================================= */
// Cada item: { id, file, data, status: "pendente"|"pronto"|"erro"|"salvo",
//              cargas: [], pesoLiquido: 0, mensagem: "" }
let itens = [];

const pdfInput   = document.getElementById("pdfInput");
const infoEl     = document.getElementById("info");
const listaEl    = document.getElementById("listaArquivos");
const previewEl  = document.getElementById("preview");
const statusEl   = document.getElementById("status");
const btnProc    = document.getElementById("btnProcessar");
const btnSalvar  = document.getElementById("btnSalvar");
const btnLimpar  = document.getElementById("btnLimpar");
const btnZerar   = document.getElementById("btnZerarTudo");
const chkSubstGlobal = document.getElementById("chkSubstituirGlobal");
const statusLocal = document.getElementById("statusLocal");

if (statusLocal) {
  statusLocal.textContent = "🔥 Firebase conectado";
  statusLocal.className = "status ok";
}

/* =========================================================
   EVENTOS
   ========================================================= */
pdfInput.addEventListener("change", (e) => {
  const files = [...e.target.files];

  if (files.length === 0) {
    infoEl.textContent = "Nenhum arquivo selecionado.";
    return;
  }

  // Adiciona à lista existente (permite acumular de várias seleções)
  files.forEach(file => {
    // Evita duplicar o mesmo arquivo pelo nome+tamanho
    const jaExiste = itens.some(it =>
      it.file.name === file.name && it.file.size === file.size
    );
    if (jaExiste) return;

    itens.push({
      id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      data: "",
      status: "pendente",
      cargas: [],
      pesoLiquido: 0,
      mensagem: ""
    });
  });

  infoEl.textContent = `${itens.length} PDF(s) na lista.`;
  renderLista();
  atualizarBotoes();

  // Reseta o input pra permitir selecionar o MESMO arquivo de novo
  pdfInput.value = "";
});

btnProc.addEventListener("click", processarTodos);
btnSalvar.addEventListener("click", salvarTodos);
btnLimpar.addEventListener("click", limparTudo);

btnZerar.addEventListener("click", async () => {
  const ok = await pedirSenha(
    "Zerar base remota",
    "⚠️ ATENÇÃO: Isso apaga TODAS as cargas de TODOS os dias no Firebase. Essa ação não pode ser desfeita."
  );
  if (!ok) return;

  try {
    statusEl.textContent = "🗑 Apagando tudo no Firebase...";
    statusEl.className = "status-msg";

    const snap = await getDocs(collection(db, "cargas"));
    let removidos = 0;
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
      removidos++;
    }

    statusEl.textContent = `✅ Base remota zerada (${removidos} dia(s) removido(s)).`;
    statusEl.className = "status-msg ok";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "❌ Erro ao zerar: " + err.message;
    statusEl.className = "status-msg erro";
  }
});

/* =========================================================
   RENDERIZAR LISTA DE ARQUIVOS
   ========================================================= */
function renderLista() {
  if (itens.length === 0) {
    listaEl.innerHTML = `<p class="vazio">Nenhum PDF carregado ainda. Selecione acima.</p>`;
    return;
  }

  listaEl.innerHTML = itens.map((it, idx) => `
    <div class="item-pdf" data-id="${it.id}">
      <div class="item-numero">${idx + 1}</div>
      <div class="item-info">
        <div class="item-nome" title="${escapeHtml(it.file.name)}">
          📄 ${escapeHtml(it.file.name)}
          <small>(${formatarBytes(it.file.size)})</small>
        </div>
        <div class="item-status status-${it.status}">${labelStatus(it)}</div>
      </div>
      <div class="item-data">
        <label>Data:</label>
        <input type="date"
               data-id="${it.id}"
               class="input-data-item"
               value="${it.data}">
      </div>
      <button class="btn-remover-item" data-id="${it.id}" title="Remover">🗑</button>
    </div>
  `).join("");

  // Bind dos inputs de data
  listaEl.querySelectorAll(".input-data-item").forEach(inp => {
    inp.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      const item = itens.find(it => it.id === id);
      if (!item) return;
      item.data = e.target.value;

      // Se a data mudou, reseta o status desse item
      if (item.status === "pronto") {
        item.status = "pendente";
        item.cargas = [];
        item.pesoLiquido = 0;
        item.mensagem = "";
        renderLista();
        atualizarBotoes();
      }
    });
  });

  // Bind dos botões remover
  listaEl.querySelectorAll(".btn-remover-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      itens = itens.filter(it => it.id !== id);
      infoEl.textContent = itens.length === 0
        ? "Nenhum arquivo selecionado."
        : `${itens.length} PDF(s) na lista.`;
      renderLista();
      atualizarBotoes();
    });
  });
}

function labelStatus(it) {
  switch (it.status) {
    case "pendente": return "⏳ Aguardando data e processamento";
    case "pronto":   return `✅ Pronto — ${it.cargas.length} carga(s) • ${formatarPeso(it.pesoLiquido)} kg`;
    case "erro":     return `❌ ${it.mensagem || "Erro ao processar"}`;
    case "salvo":    return `💾 Salvo no Firebase — ${it.cargas.length} carga(s) • ${formatarPeso(it.pesoLiquido)} kg`;
    default:         return "";
  }
}

function atualizarBotoes() {
  const prontos = itens.filter(it => it.status === "pronto").length;
  btnSalvar.disabled = prontos === 0;
}

/* =========================================================
   PROCESSAR TODOS OS PDFs
   ========================================================= */
async function processarTodos() {
  if (itens.length === 0) {
    alert("⚠️ Selecione pelo menos um PDF.");
    return;
  }

  // Valida datas
  const semData = itens.filter(it => !it.data);
  if (semData.length > 0) {
    alert(`⚠️ ${semData.length} arquivo(s) sem data definida. Preencha a data de todos antes de processar.`);
    return;
  }

  // Verifica duplicatas de data
  const datas = itens.map(it => it.data);
  const datasDuplicadas = datas.filter((d, i) => datas.indexOf(d) !== i);
  if (datasDuplicadas.length > 0) {
    const unicas = [...new Set(datasDuplicadas)].sort();
    if (!confirm(
      `⚠️ Existem ${unicas.length} data(s) repetida(s): ${unicas.map(formatarDataBR).join(", ")}.\n\n` +
      `Todos os PDFs com a mesma data serão salvos no mesmo dia (o último sobrescreve se "Substituir" estiver marcado).\n\n` +
      `Continuar?`
    )) return;
  }

  btnProc.disabled = true;
  btnSalvar.disabled = true;
  statusEl.textContent = "⏳ Processando PDFs...";
  statusEl.className = "status-msg";

  let processados = 0;
  let erros = 0;

  for (const item of itens) {
    if (item.status === "pronto" || item.status === "salvo") continue;

    try {
      const texto = await extrairTextoPDF(item.file);
      const resultado = parsearTexto(texto);

      item.cargas = resultado.cargas;
      item.pesoLiquido = resultado.pesoLiquido;
      item.status = "pronto";
      item.mensagem = "";
      processados++;
    } catch (err) {
      console.error(err);
      item.status = "erro";
      item.mensagem = err.message;
      erros++;
    }

    renderLista();
    renderPreview();
  }

  // Status final
  const prontos = itens.filter(it => it.status === "pronto").length;
  const totalCargas = itens
    .filter(it => it.status === "pronto")
    .reduce((acc, it) => acc + it.cargas.length, 0);
  const totalPeso = itens
    .filter(it => it.status === "pronto")
    .reduce((acc, it) => acc + it.pesoLiquido, 0);

  statusEl.textContent = `✅ ${processados} arquivo(s) processado(s) • ${totalCargas} carga(s) • ${formatarPeso(totalPeso)} kg` +
    (erros > 0 ? ` • ❌ ${erros} com erro` : "");
  statusEl.className = "status-msg " + (erros > 0 ? "warn" : "ok");

  btnProc.disabled = false;
  atualizarBotoes();
}

/* =========================================================
   EXTRAÇÃO DE TEXTO DO PDF
   ========================================================= */
async function extrairTextoPDF(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const linhas = {};
    content.items.forEach(it => {
      const y = Math.round(it.transform[5]);
      if (!linhas[y]) linhas[y] = [];
      linhas[y].push({ x: it.transform[4], t: it.str });
    });

    const ys = Object.keys(linhas).map(Number).sort((a, b) => b - a);
    ys.forEach(y => {
      const linha = linhas[y]
        .sort((a, b) => a.x - b.x)
        .map(i => i.t)
        .join(" ")
        .replace(/\s+/g, " ")
        .trimEnd();
      if (linha) out += linha + "\n";
    });
  }
  return out;
}

/* =========================================================
   PARSER — retorna { cargas: [...], pesoLiquido: number }
   ========================================================= */
function parsearTexto(texto) {
  const linhas = texto.split("\n");
  const cargas = [];
  let cargaAtual = null;
  let descricaoPendente = null;
  let pesoLiquidoTotal = 0;

  const reIgnorar = /^(Grupo -|Relatório para|Página \d+ de|Código\s+Descrição|FRCML_|Wonder Sistemas|Quantidade:|Peso Bruto|Volume Cúbico|Qtd Pedidos|Qtd Clientes|Vendedor\(es\)|ID Pedido\(s\)|Carga\(s\):)/i;
  const rePesoLiquido = /Peso\s+L[ií]quido\(kg\):\s*([\d.]+,\d+)/i;

  const reCargaNumero    = /^Carga:\s+(\d+)\s*$/i;
  const reCargaSoTexto   = /^Carga:\s*$/i;
  const reSoNumero       = /^(\d{4,6})$/;
  const reCodQtdUnid     = /^(\d{3,6})\s+([\d.]+,\d+)\s+([A-Z0-9]{2,4})$/;
  const reCodDescQtdUnid = /^(\d{3,6})\s+(.+?)\s+([\d.]+,\d+)\s+([A-Z0-9]{2,4})$/;

  function finalizar() {
    if (cargaAtual && cargaAtual.produtos.length > 0) cargas.push(cargaAtual);
    cargaAtual = null;
  }

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (!linha) continue;

    const mPeso = linha.match(rePesoLiquido);
    if (mPeso) {
      pesoLiquidoTotal = normalizarQtd(mPeso[1]);
      continue;
    }

    if (reIgnorar.test(linha)) continue;

    let m = linha.match(reCargaNumero);
    if (m) {
      finalizar();
      cargaAtual = { numeroCarga: m[1], produtos: [] };
      descricaoPendente = null;
      continue;
    }

    if (reCargaSoTexto.test(linha)) {
      let j = i + 1;
      while (j < linhas.length && !linhas[j].trim()) j++;
      const prox = linhas[j] ? linhas[j].trim() : "";
      const mNum = prox.match(reSoNumero);
      if (mNum) {
        finalizar();
        cargaAtual = { numeroCarga: mNum[1], produtos: [] };
        descricaoPendente = null;
        i = j;
      }
      continue;
    }

    if (!cargaAtual) continue;

    m = linha.match(reCodDescQtdUnid);
    if (m) {
      cargaAtual.produtos.push({
        codigo: m[1], nome: m[2].trim(),
        quantidade: normalizarQtd(m[3]), unidade: m[4]
      });
      descricaoPendente = null;
      continue;
    }

    m = linha.match(reCodQtdUnid);
    if (m) {
      cargaAtual.produtos.push({
        codigo: m[1], nome: descricaoPendente || "(sem descrição)",
        quantidade: normalizarQtd(m[2]), unidade: m[3]
      });
      descricaoPendente = null;
      continue;
    }

    if (!reSoNumero.test(linha)) {
      descricaoPendente = linha;
    }
  }

  finalizar();
  return { cargas, pesoLiquido: pesoLiquidoTotal };
}

function normalizarQtd(str) {
  return parseFloat(str.replace(/\./g, "").replace(",", "."));
}

function deduplicar(lista) {
  const mapa = new Map();
  lista.forEach(c => {
    if (mapa.has(c.numeroCarga)) {
      const ex = mapa.get(c.numeroCarga);
      c.produtos.forEach(p => {
        const jaTem = ex.produtos.some(
          e => e.codigo === p.codigo && e.nome === p.nome && e.quantidade === p.quantidade
        );
        if (!jaTem) ex.produtos.push(p);
      });
    } else {
      mapa.set(c.numeroCarga, c);
    }
  });
  return [...mapa.values()];
}

/* =========================================================
   HELPERS
   ========================================================= */
function formatarPeso(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatarDataBR(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function formatarBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]
  ));
}

/* =========================================================
   PREVIEW
   ========================================================= */
function renderPreview() {
  const prontos = itens.filter(it => it.status === "pronto");

  if (prontos.length === 0) {
    previewEl.innerHTML = `<p class="vazio">O preview aparecerá aqui depois de processar.</p>`;
    return;
  }

  let html = "";
  prontos.forEach(item => {
    const dataBR = formatarDataBR(item.data);
    const pesoFmt = formatarPeso(item.pesoLiquido);

    html += `
      <div class="preview-dia">
        <div class="preview-dia-header">
          <span>📅 <b>${dataBR}</b> — ${item.cargas.length} carga(s)</span>
          <span class="preview-peso">⚖️ ${pesoFmt} kg</span>
        </div>
        <div class="preview-dia-arquivo">📄 ${escapeHtml(item.file.name)}</div>
    `;

    item.cargas.forEach(c => {
      html += `
        <details class="carga-preview">
          <summary><b>Carga ${c.numeroCarga}</b> — ${c.produtos.length} produto(s)</summary>
          <table class="tbl-preview">
            <thead><tr><th>Cód</th><th>Produto</th><th>Qtd</th><th>Un</th></tr></thead>
            <tbody>
              ${c.produtos.map(p => `
                <tr>
                  <td>${p.codigo}</td>
                  <td>${escapeHtml(p.nome)}</td>
                  <td class="num">${p.quantidade.toLocaleString("pt-BR")}</td>
                  <td>${p.unidade}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </details>`;
    });

    html += `</div>`;
  });

  previewEl.innerHTML = html;
}

/* =========================================================
   SALVAR TODOS NO FIREBASE
   ========================================================= */
async function salvarTodos() {
  const prontos = itens.filter(it => it.status === "pronto");
  if (prontos.length === 0) return;

  const substituirGlobal = chkSubstGlobal.checked;

  btnSalvar.disabled = true;
  btnProc.disabled = true;
  statusEl.textContent = "💾 Salvando no Firebase...";
  statusEl.className = "status-msg";

  let salvos = 0;
  let erros = 0;

  // Agrupa por data (caso tenha mais de um PDF pra mesma data)
  const porData = {};
  prontos.forEach(it => {
    if (!porData[it.data]) porData[it.data] = [];
    porData[it.data].push(it);
  });

  for (const [dataAlvo, itemsDoDia] of Object.entries(porData)) {
    try {
      const docRef = doc(db, "cargas", dataAlvo);
      const docSnap = await getDoc(docRef);

      let cargasFinal = [];
      let pesoLiquidoFinal = 0;

      if (docSnap.exists() && !substituirGlobal) {
        // MERGE: soma com o que já existe
        const dadosAntigos = docSnap.data();
        const antigas = dadosAntigos.cargas || [];
        const pesoAntigo = dadosAntigos.pesoLiquido || 0;

        const mapa = new Map();
        antigas.forEach(c => mapa.set(c.numeroCarga, c));

        itemsDoDia.forEach(it => {
          it.cargas.forEach(c => {
            if (mapa.has(c.numeroCarga)) {
              const existente = mapa.get(c.numeroCarga);
              const codigosExistentes = new Set(existente.produtos.map(p => p.codigo));
              c.produtos.forEach(p => {
                if (!codigosExistentes.has(p.codigo)) existente.produtos.push(p);
              });
            } else {
              mapa.set(c.numeroCarga, c);
            }
          });
        });

        cargasFinal = [...mapa.values()];
        pesoLiquidoFinal = pesoAntigo + itemsDoDia.reduce((acc, it) => acc + it.pesoLiquido, 0);
      } else {
        // SUBSTITUIR (ou primeira vez)
        const todas = [];
        itemsDoDia.forEach(it => todas.push(...it.cargas));
        cargasFinal = deduplicar(todas);
        pesoLiquidoFinal = itemsDoDia.reduce((acc, it) => acc + it.pesoLiquido, 0);
      }

      cargasFinal.sort((a, b) =>
        String(a.numeroCarga).localeCompare(String(b.numeroCarga), undefined, { numeric: true })
      );

      await setDoc(docRef, {
        data: dataAlvo,
        cargas: cargasFinal,
        pesoLiquido: pesoLiquidoFinal,
        atualizadoEm: serverTimestamp(),
        criadoEm: docSnap.exists() ? docSnap.data().criadoEm : serverTimestamp(),
        origem: "importacao-pdf"
      });

      // Marca os itens como salvos
      itemsDoDia.forEach(it => { it.status = "salvo"; });
      salvos += itemsDoDia.length;
    } catch (err) {
      console.error("Erro ao salvar", dataAlvo, err);
      itemsDoDia.forEach(it => {
        it.status = "erro";
        it.mensagem = err.message;
      });
      erros += itemsDoDia.length;
    }

    renderLista();
  }

  renderPreview();

  statusEl.textContent = `✅ ${salvos} arquivo(s) salvo(s) no Firebase.` +
    (erros > 0 ? ` ❌ ${erros} com erro.` : "");
  statusEl.className = "status-msg " + (erros > 0 ? "warn" : "ok");

  // Após 2s, remove os itens salvos e limpa tudo
  setTimeout(() => {
    itens = itens.filter(it => it.status !== "salvo");
    if (itens.length === 0) {
      limparTudo();
      statusEl.textContent = "✅ Pronto. Pode selecionar novos PDFs.";
      statusEl.className = "status-msg ok";
    } else {
      renderLista();
      renderPreview();
      atualizarBotoes();
      statusEl.textContent = "Alguns itens ainda pendentes ou com erro.";
      statusEl.className = "status-msg warn";
    }
  }, 1500);

  btnProc.disabled = false;
}

/* =========================================================
   LIMPAR TUDO
   ========================================================= */
function limparTudo() {
  itens = [];
  pdfInput.value = "";
  infoEl.textContent = "Nenhum arquivo selecionado.";
  listaEl.innerHTML = `<p class="vazio">Nenhum PDF carregado ainda. Selecione acima.</p>`;
  previewEl.innerHTML = `<p class="vazio">O preview aparecerá aqui depois de processar.</p>`;
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  btnSalvar.disabled = true;
  btnProc.disabled = false;
}