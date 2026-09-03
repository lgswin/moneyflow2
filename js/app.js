const STORAGE_KEY = "moneyflow2";

const CURRENCY = {
  KRW: { label: "원화", unit: "원", symbol: "₩" },
  USD: { label: "달러", unit: "USD", symbol: "$" },
};

const app = document.getElementById("app");
const modalRoot = document.getElementById("modal-root");

const state = loadState();
const view = { page: "home", accountId: null };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accounts: [], transactions: [] };
    const data = JSON.parse(raw);
    return {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
    };
  } catch {
    return { accounts: [], transactions: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === "USD") {
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function parseAmount(value) {
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function findAccount(id) {
  return state.accounts.find((a) => a.id === id);
}

function normalizeAmount(amount, currency) {
  if (currency === "USD") return Math.round(amount * 100) / 100;
  return Math.round(amount);
}

function convertAmount(amount, from, to, usdKrwRate) {
  if (from === to) return normalizeAmount(amount, to);
  if (from === "KRW" && to === "USD") return normalizeAmount(amount / usdKrwRate, "USD");
  if (from === "USD" && to === "KRW") return normalizeAmount(amount * usdKrwRate, "KRW");
  return normalizeAmount(amount, to);
}

function getAccount(id) {
  const account = findAccount(id);
  if (!account) {
    view.page = "home";
    view.accountId = null;
    return null;
  }
  return account;
}

function render() {
  if (view.page === "detail") {
    const account = getAccount(view.accountId);
    if (account) {
      app.innerHTML = renderDetail(account);
      return;
    }
  }
  app.innerHTML = renderHome();
}

function renderHome() {
  const cards = state.accounts
    .map((account) => {
      return `
        <button class="account-card" data-action="open-account" data-id="${account.id}">
          <div>
            <h2>${escapeHtml(account.name)}</h2>
            <div class="amt">${formatMoney(account.balance, account.currency)}</div>
          </div>
          <span class="badge badge-${account.currency.toLowerCase()}">${CURRENCY[account.currency].label}</span>
        </button>
      `;
    })
    .join("");

  return `
    <header class="topbar">
      <div class="brand">
        <h1>머니플로우</h1>
        <p>계좌와 입출금을 간단히 기록합니다</p>
      </div>
      <button class="btn btn-primary" data-action="new-account">계좌 추가</button>
    </header>
    ${
      state.accounts.length
        ? `<div class="stack">${cards}</div>`
        : `<div class="empty">아직 계좌가 없습니다.<br />먼저 원화 또는 달러 계좌를 만들어 주세요.</div>`
    }
  `;
}

function renderDetail(account) {
  const txs = state.transactions
    .filter((tx) => tx.accountId === account.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const list = txs.length
    ? txs.map(renderTransaction).join("")
    : `<div class="empty">아직 거래가 없습니다.</div>`;

  return `
    <header class="topbar">
      <button class="back" data-action="go-home">← 계좌 목록</button>
      <div class="actions">
        <button class="icon-btn" data-action="edit-account">편집</button>
        <button class="icon-btn" data-action="delete-account">삭제</button>
      </div>
    </header>
    <section class="account-head">
      <div>
        <h1>${escapeHtml(account.name)}</h1>
        <p class="balance">${formatMoney(account.balance, account.currency)}</p>
      </div>
      <span class="badge badge-${account.currency.toLowerCase()}">${CURRENCY[account.currency].label}</span>
    </section>
    <div class="ops">
      <button class="btn" data-action="deposit">입금</button>
      <button class="btn" data-action="transfer">송금</button>
      <button class="btn" data-action="expense">지출</button>
    </div>
    <h2 class="section-title">거래 내역</h2>
    <div class="card">${list}</div>
  `;
}

function renderTransaction(tx) {
  const plus = tx.type === "deposit" || tx.type === "transfer_in";
  const title = {
    deposit: "입금",
    expense: "지출",
    transfer_out: "송금",
    transfer_in: "송금 입금",
  }[tx.type];

  let detail = tx.reason || "";
  if (tx.type === "transfer_out" && tx.relatedAccountName) {
    detail = `${detail ? `${escapeHtml(tx.reason)} · ` : ""}→ ${escapeHtml(tx.relatedAccountName)}`;
  } else if (tx.type === "transfer_in" && tx.relatedAccountName) {
    detail = `← ${escapeHtml(tx.relatedAccountName)}`;
  } else {
    detail = escapeHtml(detail);
  }

  if (tx.exchangeRate) {
    const rateText = `환율 1 USD = ${Number(tx.exchangeRate).toLocaleString("ko-KR")} KRW`;
    detail = detail ? `${detail} · ${rateText}` : rateText;
  }

  return `
    <div class="tx">
      <div>
        <h3>${title}</h3>
        ${detail ? `<p>${detail}</p>` : ""}
        <p>${formatDate(tx.createdAt)}</p>
      </div>
      <div class="amt ${plus ? "plus" : "minus"}">
        ${plus ? "+" : "-"}${formatMoney(tx.amount, tx.currency)}
      </div>
    </div>
  `;
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function openSheet(title, body, actions) {
  modalRoot.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <h2>${title}</h2>
      ${body}
      <div class="sheet-actions">${actions}</div>
    </div>
  `;
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

function openAccountForm(account) {
  const isEdit = Boolean(account);
  const currency = account?.currency || "KRW";
  const currencyField = isEdit
    ? `<div class="field"><span>통화</span><div class="readonly">${CURRENCY[currency].label} 계좌</div></div>`
    : `<div class="field"><span>통화</span>
        <div class="currency-pick">
          <label><input type="radio" name="currency" value="KRW" ${currency === "KRW" ? "checked" : ""} />원화</label>
          <label><input type="radio" name="currency" value="USD" ${currency === "USD" ? "checked" : ""} />달러</label>
        </div>
      </div>`;

  openSheet(
    isEdit ? "계좌 편집" : "계좌 만들기",
    `
      ${field("계좌 이름", `<input id="f-name" maxlength="40" value="${escapeHtml(account?.name || "")}" placeholder="예: 급여통장" />`)}
      ${currencyField}
      <p class="error" id="form-error" hidden></p>
    `,
    `
      <button class="btn btn-ghost" data-action="close-modal">취소</button>
      <button class="btn btn-primary" data-action="${isEdit ? "save-account" : "create-account"}">저장</button>
    `
  );
  document.getElementById("f-name").focus();
}

function openDepositForm(account) {
  openSheet(
    "입금",
    `
      ${field("입금 금액", `<input id="f-amount" inputmode="decimal" placeholder="${account.currency === "KRW" ? "100000" : "100.00"}" />`)}
      ${field("입금 사유", `<input id="f-reason" maxlength="80" placeholder="예: 월급" />`)}
      <p class="error" id="form-error" hidden></p>
    `,
    `
      <button class="btn btn-ghost" data-action="close-modal">취소</button>
      <button class="btn btn-primary" data-action="save-deposit">입금</button>
    `
  );
  document.getElementById("f-amount").focus();
}

function openExpenseForm(account) {
  openSheet(
    "지출",
    `
      ${field("지출 금액", `<input id="f-amount" inputmode="decimal" placeholder="${account.currency === "KRW" ? "12000" : "20.00"}" />`)}
      ${field("지출 사유", `<input id="f-reason" maxlength="80" placeholder="예: 점심" />`)}
      <p class="error" id="form-error" hidden></p>
    `,
    `
      <button class="btn btn-ghost" data-action="close-modal">취소</button>
      <button class="btn btn-primary" data-action="save-expense">지출</button>
    `
  );
  document.getElementById("f-amount").focus();
}

function openTransferForm(account) {
  const others = state.accounts.filter((a) => a.id !== account.id);
  if (!others.length) {
    openSheet(
      "송금",
      `<p class="error">송금할 다른 계좌가 없습니다. 먼저 상대 계좌를 만들어 주세요.</p>`,
      `<button class="btn btn-primary" data-action="close-modal">확인</button>`
    );
    return;
  }

  const options = others
    .map(
      (a) =>
        `<option value="${a.id}">${escapeHtml(a.name)} (${CURRENCY[a.currency].label})</option>`
    )
    .join("");

  openSheet(
    "송금",
    `
      <div class="field"><span>출발 계좌</span><div class="readonly">${escapeHtml(account.name)} · ${CURRENCY[account.currency].label}</div></div>
      ${field("상대 계좌", `<select id="f-target">${options}</select>`)}
      ${field("송금 금액", `<input id="f-amount" inputmode="decimal" placeholder="${account.currency === "KRW" ? "100000" : "100.00"}" />`)}
      <div id="fx-fields"></div>
      <p class="error" id="form-error" hidden></p>
    `,
    `
      <button class="btn btn-ghost" data-action="close-modal">취소</button>
      <button class="btn btn-primary" data-action="save-transfer">송금</button>
    `
  );
  updateFxFields();
  document.getElementById("f-amount").focus();
}

function selectedTargetAccount() {
  const account = findAccount(view.accountId);
  const targetId = document.getElementById("f-target")?.value;
  return { account, target: findAccount(targetId) };
}

function updateFxFields() {
  const box = document.getElementById("fx-fields");
  if (!box) return;
  const { account, target } = selectedTargetAccount();
  if (!account || !target) {
    box.innerHTML = "";
    return;
  }

  if (account.currency === target.currency) {
    box.innerHTML = `<p class="preview">같은 통화이므로 입력한 금액 그대로 이체됩니다.</p>`;
    return;
  }

  box.innerHTML = `
    ${field("환율 (1 USD = ? KRW)", `<input id="f-rate" inputmode="decimal" placeholder="1350" />`)}
    <p class="preview" id="fx-preview">환율을 입력하면 상대 계좌 입금액을 보여 줍니다.</p>
  `;
  document.getElementById("f-rate").addEventListener("input", updateFxPreview);
  document.getElementById("f-amount").addEventListener("input", updateFxPreview);
}

function updateFxPreview() {
  const preview = document.getElementById("fx-preview");
  if (!preview) return;
  const { account, target } = selectedTargetAccount();
  const amount = parseAmount(document.getElementById("f-amount")?.value);
  const rate = parseAmount(document.getElementById("f-rate")?.value);
  if (!account || !target || !(amount > 0) || !(rate > 0)) {
    preview.textContent = "환율을 입력하면 상대 계좌 입금액을 보여 줍니다.";
    return;
  }
  const converted = convertAmount(amount, account.currency, target.currency, rate);
  preview.textContent = `${formatMoney(amount, account.currency)} → ${target.name}에 ${formatMoney(converted, target.currency)} 입금`;
}

function showError(message) {
  const el = document.getElementById("form-error");
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
}

function createAccount() {
  const name = document.getElementById("f-name").value.trim();
  const currency = document.querySelector('input[name="currency"]:checked')?.value;
  if (!name) return showError("계좌 이름을 입력해 주세요.");
  if (currency !== "KRW" && currency !== "USD") return showError("통화를 선택해 주세요.");
  state.accounts.push({ id: uid(), name, currency, balance: 0 });
  saveState();
  closeModal();
  render();
}

function saveAccount() {
  const account = findAccount(view.accountId);
  const name = document.getElementById("f-name").value.trim();
  if (!account) return closeModal();
  if (!name) return showError("계좌 이름을 입력해 주세요.");
  account.name = name;
  saveState();
  closeModal();
  render();
}

function deleteAccount() {
  const account = findAccount(view.accountId);
  if (!account) return closeModal();
  state.transactions = state.transactions.filter((tx) => tx.accountId !== account.id);
  state.accounts = state.accounts.filter((a) => a.id !== account.id);
  view.page = "home";
  view.accountId = null;
  saveState();
  closeModal();
  render();
}

function saveDeposit() {
  const account = findAccount(view.accountId);
  if (!account) return closeModal();
  let amount = parseAmount(document.getElementById("f-amount").value);
  const reason = document.getElementById("f-reason").value.trim();
  if (!(amount > 0)) return showError("입금 금액을 올바르게 입력해 주세요.");
  if (!reason) return showError("입금 사유를 입력해 주세요.");
  amount = normalizeAmount(amount, account.currency);
  account.balance += amount;
  state.transactions.push({
    id: uid(),
    accountId: account.id,
    type: "deposit",
    amount,
    currency: account.currency,
    reason,
    createdAt: new Date().toISOString(),
  });
  saveState();
  closeModal();
  render();
}

function saveExpense() {
  const account = findAccount(view.accountId);
  if (!account) return closeModal();
  let amount = parseAmount(document.getElementById("f-amount").value);
  const reason = document.getElementById("f-reason").value.trim();
  if (!(amount > 0)) return showError("지출 금액을 올바르게 입력해 주세요.");
  if (!reason) return showError("지출 사유를 입력해 주세요.");
  amount = normalizeAmount(amount, account.currency);
  if (amount > account.balance) return showError("잔액이 부족합니다.");
  account.balance -= amount;
  state.transactions.push({
    id: uid(),
    accountId: account.id,
    type: "expense",
    amount,
    currency: account.currency,
    reason,
    createdAt: new Date().toISOString(),
  });
  saveState();
  closeModal();
  render();
}

function saveTransfer() {
  const { account, target } = selectedTargetAccount();
  if (!account || !target) return showError("상대 계좌를 선택해 주세요.");
  let amount = parseAmount(document.getElementById("f-amount").value);
  if (!(amount > 0)) return showError("송금 금액을 올바르게 입력해 주세요.");
  amount = normalizeAmount(amount, account.currency);
  if (amount > account.balance) return showError("잔액이 부족합니다.");

  let converted = amount;
  let exchangeRate = null;
  if (account.currency !== target.currency) {
    const rate = parseAmount(document.getElementById("f-rate")?.value);
    if (!(rate > 0)) return showError("환율을 입력해 주세요. 예: 1 USD = 1350 KRW");
    converted = convertAmount(amount, account.currency, target.currency, rate);
    exchangeRate = rate;
  }

  const now = new Date().toISOString();
  account.balance -= amount;
  target.balance += converted;
  state.transactions.push({
    id: uid(),
    accountId: account.id,
    type: "transfer_out",
    amount,
    currency: account.currency,
    relatedAccountId: target.id,
    relatedAccountName: target.name,
    exchangeRate,
    createdAt: now,
  });
  state.transactions.push({
    id: uid(),
    accountId: target.id,
    type: "transfer_in",
    amount: converted,
    currency: target.currency,
    relatedAccountId: account.id,
    relatedAccountName: account.name,
    exchangeRate,
    createdAt: now,
  });
  saveState();
  closeModal();
  render();
}

app.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const account = findAccount(view.accountId);

  if (action === "open-account") {
    view.page = "detail";
    view.accountId = btn.dataset.id;
    render();
    return;
  }
  if (action === "go-home") {
    view.page = "home";
    view.accountId = null;
    render();
    return;
  }
  if (action === "new-account") return openAccountForm();
  if (action === "edit-account" && account) return openAccountForm(account);
  if (action === "delete-account" && account) {
    openSheet(
      "계좌 삭제",
      `<p>‘${escapeHtml(account.name)}’ 계좌와 이 계좌의 거래 내역을 삭제할까요?</p>`,
      `
        <button class="btn btn-ghost" data-action="close-modal">취소</button>
        <button class="btn btn-danger" data-action="confirm-delete">삭제</button>
      `
    );
    return;
  }
  if (action === "deposit" && account) return openDepositForm(account);
  if (action === "expense" && account) return openExpenseForm(account);
  if (action === "transfer" && account) return openTransferForm(account);
});

modalRoot.addEventListener("click", (event) => {
  if (event.target === modalRoot) {
    closeModal();
    return;
  }
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "close-modal") return closeModal();
  if (action === "create-account") return createAccount();
  if (action === "save-account") return saveAccount();
  if (action === "confirm-delete") return deleteAccount();
  if (action === "save-deposit") return saveDeposit();
  if (action === "save-expense") return saveExpense();
  if (action === "save-transfer") return saveTransfer();
});

modalRoot.addEventListener("change", (event) => {
  if (event.target.id === "f-target") updateFxFields();
});

modalRoot.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") return;
  const submit = modalRoot.querySelector(".btn-primary, .btn-danger");
  if (submit) {
    event.preventDefault();
    submit.click();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

render();
