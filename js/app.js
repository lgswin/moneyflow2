const STORAGE_KEY = "moneyflow2";

const CURRENCY = {
  KRW: { label: "원화", short: "KRW", symbol: "₩" },
  CAD: { label: "캐나다 달러", short: "CAD", symbol: "C$" },
};

const DEFAULT_REASONS = {
  deposit: ["월급", "용돈", "이자", "환급", "기타 수입"],
  transfer: ["저축", "생활비", "투자", "정산", "기타 송금"],
  expense: ["식비", "교통", "주거", "쇼핑", "의료", "통신", "기타 지출"],
  plan: ["월세", "관리비", "보험", "카드대금"],
};

const REASON_LABEL = {
  deposit: "입금(수입)",
  transfer: "송금",
  expense: "지출",
  plan: "지출계획",
};

const app = document.getElementById("app");
const modalRoot = document.getElementById("modal-root");

const state = loadState();
const view = { page: "dashboard", accountId: null };
let pendingImport = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return migrateState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

function emptyState() {
  return {
    accounts: [],
    transactions: [],
    reasons: cloneReasons(DEFAULT_REASONS),
    plans: [],
    statsRate: 1000,
    editMode: false,
  };
}

function cloneReasons(source) {
  return {
    deposit: [...source.deposit],
    transfer: [...source.transfer],
    expense: [...source.expense],
    plan: [...(source.plan || DEFAULT_REASONS.plan)],
  };
}

function migrateState(data) {
  const accounts = (Array.isArray(data.accounts) ? data.accounts : []).map((account) => ({
    ...account,
    currency: account.currency === "USD" ? "CAD" : account.currency,
  }));
  const transactions = (Array.isArray(data.transactions) ? data.transactions : []).map((tx) => ({
    ...tx,
    currency: tx.currency === "USD" ? "CAD" : tx.currency,
  }));
  const reasons = cloneReasons(DEFAULT_REASONS);
  if (data.reasons) {
    for (const kind of Object.keys(reasons)) {
      if (Array.isArray(data.reasons[kind]) && data.reasons[kind].length) {
        reasons[kind] = data.reasons[kind].map(String);
      }
    }
  }
  const lastRate = [...transactions].reverse().find((tx) => tx.exchangeRate > 0)?.exchangeRate;
  const statsRate = Number(data.statsRate) > 0 ? Number(data.statsRate) : lastRate || 1000;
  const plans = (Array.isArray(data.plans) ? data.plans : [])
    .filter((plan) => plan && plan.reason)
    .map((plan) => ({
      id: plan.id || uid(),
      reason: String(plan.reason),
      accountId: plan.accountId || "",
      amount: Number(plan.amount) || 0,
    }));
  return { accounts, transactions, reasons, plans, statsRate, editMode: Boolean(data.editMode) };
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
  if (currency === "CAD") {
    return `C$${n.toLocaleString("en-CA", {
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
  if (currency === "CAD") return Math.round(amount * 100) / 100;
  return Math.round(amount);
}

function convertAmount(amount, from, to, cadKrwRate) {
  if (from === to) return normalizeAmount(amount, to);
  if (from === "KRW" && to === "CAD") return normalizeAmount(amount / cadKrwRate, "CAD");
  if (from === "CAD" && to === "KRW") return normalizeAmount(amount * cadKrwRate, "KRW");
  return normalizeAmount(amount, to);
}

function getAccount(id) {
  const account = findAccount(id);
  if (!account) {
    view.page = "accounts";
    view.accountId = null;
    return null;
  }
  return account;
}

function sumsByCurrency(items, getAmount = (item) => item.amount, getCurrency = (item) => item.currency) {
  return items.reduce(
    (acc, item) => {
      const currency = getCurrency(item);
      if (currency === "CAD") acc.CAD += Number(getAmount(item)) || 0;
      else acc.KRW += Number(getAmount(item)) || 0;
      return acc;
    },
    { KRW: 0, CAD: 0 }
  );
}

function dashboardStats() {
  const balances = sumsByCurrency(state.accounts, (a) => a.balance, (a) => a.currency);
  const rate = state.statsRate > 0 ? state.statsRate : 1000;
  const deposits = state.transactions.filter((tx) => tx.type === "deposit");
  const expenses = state.transactions.filter((tx) => tx.type === "expense");
  const transfers = state.transactions.filter((tx) => tx.type === "transfer_out");
  return {
    rate,
    balances,
    totalKrw: balances.KRW + convertAmount(balances.CAD, "CAD", "KRW", rate),
    totalCad: balances.CAD + convertAmount(balances.KRW, "KRW", "CAD", rate),
    deposit: { count: deposits.length, sums: sumsByCurrency(deposits), byReason: groupByReason(deposits) },
    transfer: { count: transfers.length, sums: sumsByCurrency(transfers), byReason: groupByReason(transfers) },
    expense: { count: expenses.length, sums: sumsByCurrency(expenses), byReason: groupByReason(expenses) },
  };
}

function groupByReason(items) {
  const map = new Map();
  for (const tx of items) {
    const key = tx.reason || "기타";
    if (!map.has(key)) map.set(key, { KRW: 0, CAD: 0 });
    const row = map.get(key);
    if (tx.currency === "CAD") row.CAD += Number(tx.amount) || 0;
    else row.KRW += Number(tx.amount) || 0;
  }
  return [...map.entries()];
}

function findPlan(reason) {
  return state.plans.find((plan) => plan.reason === reason);
}

function planMatches(tx, plan) {
  return (
    (tx.type === "expense" || tx.type === "transfer_out") &&
    tx.accountId === plan.accountId &&
    tx.reason === plan.reason
  );
}

function planProgress(plan) {
  const account = findAccount(plan.accountId);
  const txs = state.transactions.filter((tx) => planMatches(tx, plan));
  const spent = txs.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const planned = Number(plan.amount) || 0;
  const expenseCount = txs.filter((tx) => tx.type === "expense").length;
  const transferCount = txs.filter((tx) => tx.type === "transfer_out").length;
  let status = "wait";
  if (planned > 0 && spent >= planned) status = spent > planned ? "over" : "done";
  else if (spent > 0) status = "partial";
  const ratio = planned > 0 ? Math.min(spent / planned, 1) : 0;
  return { account, spent, planned, expenseCount, transferCount, status, ratio, txs };
}

function activeTab() {
  if (view.page === "dashboard") return "dashboard";
  if (view.page === "accounts" || view.page === "detail") return "accounts";
  return "settings";
}

function renderTabbar() {
  const active = activeTab();
  const tabs = [
    ["dashboard", "대시보드"],
    ["accounts", "계좌"],
    ["settings", "설정"],
  ];
  return `
    <nav class="tabbar" aria-label="주요 메뉴">
      ${tabs
        .map(
          ([id, label]) => `
            <button class="tab ${active === id ? "is-active" : ""}" data-action="tab-${id}">${label}</button>
          `
        )
        .join("")}
    </nav>
  `;
}

function render() {
  let inner = "";
  if (view.page === "detail") {
    const account = getAccount(view.accountId);
    inner = account ? renderDetail(account) : renderAccounts();
  } else if (view.page === "accounts") {
    inner = renderAccounts();
  } else if (view.page === "settings") {
    inner = renderSettings();
  } else if (view.page === "reasons") {
    inner = renderReasons();
  } else if (view.page === "plans") {
    inner = renderPlans();
  } else if (view.page === "edit-deposits") {
    inner = renderEditDeposits();
  } else {
    inner = renderDashboard();
  }
  app.innerHTML = `<div class="page">${inner}</div>${renderTabbar()}`;
}

function renderMoneyPair(sums) {
  return `
    <div class="amt">${formatMoney(sums.KRW, "KRW")}</div>
    <div class="amt-sub">${formatMoney(sums.CAD, "CAD")}</div>
  `;
}

function renderReasonLines(rows) {
  if (!rows.length) return `<p class="hint">아직 내역이 없습니다.</p>`;
  return rows
    .map(([reason, sums]) => {
      const parts = [];
      if (sums.KRW) parts.push(formatMoney(sums.KRW, "KRW"));
      if (sums.CAD) parts.push(formatMoney(sums.CAD, "CAD"));
      return `<li><span>${escapeHtml(reason)}</span><strong>${parts.join(" · ") || "—"}</strong></li>`;
    })
    .join("");
}

function renderDashboard() {
  const stats = dashboardStats();
  return `
    <header class="topbar">
      <div class="brand">
        <h1>대시보드</h1>
        <p>잔액과 지출계획, 입출 통계를 봅니다</p>
      </div>
    </header>

    <section class="dash-hero card">
      <p class="section-title">전체 총 금액</p>
      <p class="balance">${formatMoney(stats.totalKrw, "KRW")}</p>
      <p class="hero-sub">${formatMoney(stats.totalCad, "CAD")}</p>
      <label class="rate-row">
        <span>통계용 환율 1 CAD =</span>
        <input id="stats-rate" inputmode="decimal" value="${escapeHtml(String(stats.rate))}" />
        <span>KRW</span>
      </label>
    </section>

    <section class="dash-grid">
      <article class="card stat-card">
        <p class="section-title">원화</p>
        <p class="amt">${formatMoney(stats.balances.KRW, "KRW")}</p>
      </article>
      <article class="card stat-card">
        <p class="section-title">캐나다 달러</p>
        <p class="amt">${formatMoney(stats.balances.CAD, "CAD")}</p>
      </article>
    </section>

    <h2 class="section-title block-title">지출계획</h2>
    ${renderPlanDashboard()}

    <h2 class="section-title block-title">입출 통계</h2>
    <section class="flow-grid">
      ${renderFlowCard("입금(수입)", stats.deposit, "plus")}
      ${renderFlowCard("송금", stats.transfer, "")}
      ${renderFlowCard("지출", stats.expense, "minus")}
    </section>
  `;
}

function renderAccountCards() {
  return state.accounts
    .map(
      (account) => `
        <button class="account-card" data-action="open-account" data-id="${account.id}">
          <div>
            <h2>${escapeHtml(account.name)}</h2>
            <div class="amt">${formatMoney(account.balance, account.currency)}</div>
          </div>
          <span class="badge badge-${account.currency.toLowerCase()}">${CURRENCY[account.currency].label}</span>
        </button>
      `
    )
    .join("");
}

function renderAccounts() {
  return `
    <header class="topbar">
      <div class="brand">
        <h1>계좌</h1>
        <p>계좌를 열고 입금, 송금, 지출을 기록합니다</p>
      </div>
    </header>
    ${
      state.accounts.length
        ? `<div class="stack">${renderAccountCards()}</div>`
        : `<div class="empty">아직 계좌가 없습니다.<br />설정에서 계좌를 추가해 주세요.</div>`
    }
  `;
}

function renderSettings() {
  return `
    <header class="topbar">
      <div class="brand">
        <h1>설정</h1>
        <p>계좌와 사유, 지출계획을 관리합니다</p>
      </div>
    </header>
    <div class="stack">
      <button class="menu-card" data-action="new-account">
        <div>
          <h2>계좌 추가</h2>
          <p>원화 또는 캐나다 달러 계좌를 만듭니다</p>
        </div>
      </button>
      <button class="menu-card" data-action="open-reasons">
        <div>
          <h2>사유</h2>
          <p>입금, 송금, 지출, 지출계획 사유를 관리합니다</p>
        </div>
      </button>
      <button class="menu-card" data-action="open-plans">
        <div>
          <h2>계획 설정</h2>
          <p>지출계획별 출금 계좌와 금액을 지정합니다</p>
        </div>
      </button>
      <button class="menu-card" data-action="toggle-edit-mode" aria-pressed="${state.editMode}">
        <div>
          <h2>수정 모드</h2>
          <p>${state.editMode ? "켜짐 · 각 계좌의 입금 금액을 고칠 수 있습니다" : "꺼짐 · 켜면 입금 금액을 수정할 수 있습니다"}</p>
        </div>
        <span class="toggle ${state.editMode ? "is-on" : ""}" aria-hidden="true"></span>
      </button>
      ${
        state.editMode
          ? `<button class="menu-card" data-action="open-edit-deposits">
              <div>
                <h2>입금 금액 수정</h2>
                <p>계좌별 입금 내역 금액을 고칩니다</p>
              </div>
            </button>`
          : ""
      }
      <button class="menu-card" data-action="export-data">
        <div>
          <h2>데이터 내보내기</h2>
          <p>저장된 모든 내용을 JSON 파일로 받습니다</p>
        </div>
      </button>
      <button class="menu-card" data-action="import-data">
        <div>
          <h2>데이터 복원</h2>
          <p>JSON 파일을 불러와 현재 데이터를 바꿉니다</p>
        </div>
      </button>
      <input id="restore-file" type="file" accept="application/json,.json" hidden />
    </div>
  `;
}

function planStatusLabel(status) {
  return {
    wait: "미확인",
    partial: "일부 확인",
    done: "확인 완료",
    over: "초과",
  }[status];
}

function renderPlanDashboard() {
  const items = (state.reasons.plan || [])
    .map((reason) => findPlan(reason))
    .filter((plan) => plan && plan.accountId && plan.amount > 0);

  if (!items.length) {
    return `<div class="empty">아직 지출계획이 없습니다.<br />설정에서 사유와 출금 계좌, 금액을 지정해 주세요.</div>`;
  }

  const cards = items
    .map((plan) => {
      const progress = planProgress(plan);
      const currency = progress.account?.currency || "KRW";
      const accountName = progress.account?.name || "삭제된 계좌";
      const remain = Math.max(progress.planned - progress.spent, 0);
      return `
        <article class="card plan-card">
          <div class="plan-top">
            <h3>${escapeHtml(plan.reason)}</h3>
            <span class="badge badge-${progress.status}">${planStatusLabel(progress.status)}</span>
          </div>
          <p class="plan-meta">${escapeHtml(accountName)} · 계획 ${formatMoney(progress.planned, currency)}</p>
          <div class="progress is-${progress.status}"><span style="width:${Math.round(progress.ratio * 100)}%"></span></div>
          <p class="plan-meta">
            확인 ${formatMoney(progress.spent, currency)}
            · 남음 ${formatMoney(remain, currency)}
            · 지출 ${progress.expenseCount}건
            · 송금 ${progress.transferCount}건
          </p>
        </article>
      `;
    })
    .join("");

  return `<div class="plan-grid">${cards}</div>`;
}

function renderPlans() {
  if (!state.accounts.length) {
    return `
      <header class="topbar">
        <button class="back" data-action="go-settings">← 설정</button>
      </header>
      <div class="empty">계좌를 먼저 만든 뒤 지출계획을 설정할 수 있습니다.</div>
    `;
  }

  const reasons = state.reasons.plan || [];
  if (!reasons.length) {
    return `
      <header class="topbar">
        <button class="back" data-action="go-settings">← 설정</button>
        <button class="btn" data-action="open-reasons">사유 관리</button>
      </header>
      <div class="empty">지출계획 사유가 없습니다.<br />사유 관리에서 먼저 추가해 주세요.</div>
    `;
  }

  const accountOptions = (selectedId) =>
    state.accounts
      .map(
        (account) =>
          `<option value="${account.id}" ${account.id === selectedId ? "selected" : ""}>${escapeHtml(account.name)} (${CURRENCY[account.currency].label})</option>`
      )
      .join("");

  const cards = reasons
    .map((reason) => {
      const plan = findPlan(reason);
      const currency = findAccount(plan?.accountId)?.currency || state.accounts[0].currency;
      return `
        <section class="card plan-form" data-plan-reason="${escapeHtml(reason)}">
          <h2>${escapeHtml(reason)}</h2>
          ${field("출금 예정 계좌", `<select class="plan-account"><option value="">계좌 선택</option>${accountOptions(plan?.accountId)}</select>`)}
          ${field("계획 금액", `<input class="plan-amount" inputmode="decimal" value="${plan?.amount ? escapeHtml(String(plan.amount)) : ""}" placeholder="${currency === "CAD" ? "100.00" : "100000"}" />`)}
          <p class="hint">이 사유로 해당 계좌에서 지출하거나 송금하면 계획이 확인됩니다.</p>
          <p class="error" hidden></p>
          <div class="sheet-actions">
            <button class="btn btn-ghost" data-action="clear-plan" data-reason="${escapeHtml(reason)}">비우기</button>
            <button class="btn btn-primary" data-action="save-plan" data-reason="${escapeHtml(reason)}">저장</button>
          </div>
        </section>
      `;
    })
    .join("");

  return `
    <header class="topbar">
      <button class="back" data-action="go-settings">← 설정</button>
      <button class="btn" data-action="open-reasons">사유 관리</button>
    </header>
    <div class="brand page-intro">
      <h1>지출계획 설정</h1>
      <p>사유별로 출금 계좌와 금액을 정하면 대시보드에서 확인 여부를 보여 줍니다.</p>
    </div>
    <div class="stack">${cards}</div>
  `;
}

function renderFlowCard(title, group, tone) {
  return `
    <article class="card stat-card">
      <p class="section-title">${title} · ${group.count}건</p>
      <div class="${tone}">${renderMoneyPair(group.sums)}</div>
      <ul class="reason-list">${renderReasonLines(group.byReason)}</ul>
    </article>
  `;
}

function renderReasons() {
  const blocks = ["deposit", "transfer", "expense", "plan"]
    .map((kind) => {
      const rows = state.reasons[kind]
        .map(
          (reason) => `
            <li>
              <span>${escapeHtml(reason)}</span>
              <button class="btn btn-ghost btn-tiny" data-action="delete-reason" data-kind="${kind}" data-reason="${escapeHtml(reason)}">삭제</button>
            </li>
          `
        )
        .join("");
      return `
        <section class="card reason-card">
          <h2>${REASON_LABEL[kind]} 사유</h2>
          <ul class="manage-list">${rows}</ul>
          <div class="add-row">
            <input id="reason-new-${kind}" maxlength="30" placeholder="새 사유" />
            <button class="btn btn-primary" data-action="add-reason" data-kind="${kind}">추가</button>
          </div>
        </section>
      `;
    })
    .join("");

  return `
    <header class="topbar">
      <button class="back" data-action="go-settings">← 설정</button>
    </header>
    <div class="brand page-intro">
      <h1>사유 관리</h1>
      <p>입금, 송금, 지출, 지출계획에서 고를 사유를 관리합니다.</p>
    </div>
    <div class="stack">${blocks}</div>
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
      <button class="back" data-action="go-accounts">← 계좌</button>
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
    <h2 class="section-title">거래 내역${state.editMode ? " · 수정 모드" : ""}</h2>
    <div class="card tx-card">${list}</div>
  `;
}

function renderEditDeposits() {
  const blocks = state.accounts
    .map((account) => {
      const deposits = state.transactions
        .filter((tx) => tx.accountId === account.id && tx.type === "deposit")
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const rows = deposits.length
        ? deposits.map(renderTransaction).join("")
        : `<p class="hint">입금 내역이 없습니다.</p>`;
      return `
        <section class="card">
          <div class="plan-top">
            <h3>${escapeHtml(account.name)}</h3>
            <span class="badge badge-${account.currency.toLowerCase()}">${CURRENCY[account.currency].label}</span>
          </div>
          <p class="plan-meta">잔액 ${formatMoney(account.balance, account.currency)}</p>
          <div class="tx-card">${rows}</div>
        </section>
      `;
    })
    .join("");

  return `
    <header class="topbar">
      <button class="back" data-action="go-settings">← 설정</button>
    </header>
    <div class="brand page-intro">
      <h1>입금 금액 수정</h1>
      <p>입금 금액을 바꾸면 해당 계좌 잔액도 함께 맞춰집니다.</p>
    </div>
    ${
      state.accounts.length
        ? `<div class="stack">${blocks}</div>`
        : `<div class="empty">수정할 계좌가 없습니다.</div>`
    }
  `;
}

function renderTransaction(tx) {
  const plus = tx.type === "deposit" || tx.type === "transfer_in";
  const title = {
    deposit: "입금(수입)",
    expense: "지출",
    transfer_out: "송금",
    transfer_in: "송금 입금",
  }[tx.type];

  let detail = tx.reason || "";
  if (tx.type === "transfer_out" && tx.relatedAccountName) {
    detail = `${detail ? `${escapeHtml(tx.reason)} · ` : ""}→ ${escapeHtml(tx.relatedAccountName)}`;
  } else if (tx.type === "transfer_in" && tx.relatedAccountName) {
    detail = `${detail ? `${escapeHtml(tx.reason)} · ` : ""}← ${escapeHtml(tx.relatedAccountName)}`;
  } else {
    detail = escapeHtml(detail);
  }

  if (tx.exchangeRate) {
    const rateText = `환율 1 CAD = ${Number(tx.exchangeRate).toLocaleString("ko-KR")} KRW`;
    detail = detail ? `${detail} · ${rateText}` : rateText;
  }

  const canEdit = state.editMode && tx.type === "deposit";
  return `
    <div class="tx">
      <div>
        <h3>${title}</h3>
        ${detail ? `<p>${detail}</p>` : ""}
        <p>${formatDate(tx.createdAt)}</p>
      </div>
      <div class="tx-side">
        <div class="amt ${plus ? "plus" : "minus"}">
          ${plus ? "+" : "-"}${formatMoney(tx.amount, tx.currency)}
        </div>
        ${
          canEdit
            ? `<button class="btn btn-ghost btn-tiny" data-action="edit-deposit" data-id="${tx.id}">수정</button>`
            : ""
        }
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

function reasonSelect(kind) {
  const seen = new Set();
  const groups = [{ label: REASON_LABEL[kind], items: state.reasons[kind] || [] }];
  if (kind === "expense" || kind === "transfer") {
    groups.push({ label: "지출계획", items: state.reasons.plan || [] });
  }

  const markup = groups
    .map((group) => {
      const options = group.items
        .filter((reason) => {
          if (seen.has(reason)) return false;
          seen.add(reason);
          return true;
        })
        .map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`)
        .join("");
      if (!options) return "";
      return `<optgroup label="${group.label}">${options}</optgroup>`;
    })
    .join("");

  return `<select id="f-reason"><option value="">사유를 선택하세요</option>${markup}</select>`;
}

function openAccountForm(account) {
  const isEdit = Boolean(account);
  const currency = account?.currency === "CAD" ? "CAD" : "KRW";
  const currencyField = isEdit
    ? `<div class="field"><span>통화</span><div class="readonly">${CURRENCY[currency].label} 계좌</div></div>`
    : `<div class="field"><span>통화</span>
        <div class="currency-pick">
          <label><input type="radio" name="currency" value="KRW" ${currency === "KRW" ? "checked" : ""} />원화</label>
          <label><input type="radio" name="currency" value="CAD" ${currency === "CAD" ? "checked" : ""} />캐나다 달러</label>
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
    "입금(수입)",
    `
      ${field("입금 금액", `<input id="f-amount" inputmode="decimal" placeholder="${account.currency === "KRW" ? "100000" : "100.00"}" />`)}
      ${field("입금 사유", reasonSelect("deposit"))}
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
      ${field("지출 사유", reasonSelect("expense"))}
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
      ${field("송금 사유", reasonSelect("transfer"))}
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
    ${field("환율 (1 CAD = ? KRW)", `<input id="f-rate" inputmode="decimal" placeholder="1000" value="${escapeHtml(String(state.statsRate || ""))}" />`)}
    <p class="preview" id="fx-preview">환율을 입력하면 상대 계좌 입금액을 보여 줍니다.</p>
  `;
  document.getElementById("f-rate").addEventListener("input", updateFxPreview);
  document.getElementById("f-amount").addEventListener("input", updateFxPreview);
  updateFxPreview();
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
  if (currency !== "KRW" && currency !== "CAD") return showError("통화를 선택해 주세요.");
  state.accounts.push({ id: uid(), name, currency, balance: 0 });
  view.page = "accounts";
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
  state.plans = state.plans.map((plan) =>
    plan.accountId === account.id ? { ...plan, accountId: "" } : plan
  );
  view.page = "accounts";
  view.accountId = null;
  saveState();
  closeModal();
  render();
}

function readReason() {
  return document.getElementById("f-reason")?.value.trim() || "";
}

function saveDeposit() {
  const account = findAccount(view.accountId);
  if (!account) return closeModal();
  let amount = parseAmount(document.getElementById("f-amount").value);
  const reason = readReason();
  if (!(amount > 0)) return showError("입금 금액을 올바르게 입력해 주세요.");
  if (!reason) return showError("입금 사유를 선택해 주세요.");
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
  const reason = readReason();
  if (!(amount > 0)) return showError("지출 금액을 올바르게 입력해 주세요.");
  if (!reason) return showError("지출 사유를 선택해 주세요.");
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
  const reason = readReason();
  if (!(amount > 0)) return showError("송금 금액을 올바르게 입력해 주세요.");
  if (!reason) return showError("송금 사유를 선택해 주세요.");
  amount = normalizeAmount(amount, account.currency);
  if (amount > account.balance) return showError("잔액이 부족합니다.");

  let converted = amount;
  let exchangeRate = null;
  if (account.currency !== target.currency) {
    const rate = parseAmount(document.getElementById("f-rate")?.value);
    if (!(rate > 0)) return showError("환율을 입력해 주세요. 예: 1 CAD = 1000 KRW");
    converted = convertAmount(amount, account.currency, target.currency, rate);
    exchangeRate = rate;
    state.statsRate = rate;
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
    reason,
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
    reason,
    relatedAccountId: account.id,
    relatedAccountName: account.name,
    exchangeRate,
    createdAt: now,
  });
  saveState();
  closeModal();
  render();
}

function addReason(kind) {
  const input = document.getElementById(`reason-new-${kind}`);
  const name = input?.value.trim();
  if (!name) return;
  if (state.reasons[kind].includes(name)) {
    input.value = "";
    return;
  }
  state.reasons[kind].push(name);
  saveState();
  render();
}

function deleteReason(kind, reason) {
  if (kind !== "plan" && state.reasons[kind].length <= 1) return;
  state.reasons[kind] = state.reasons[kind].filter((item) => item !== reason);
  if (kind === "plan") {
    state.plans = state.plans.filter((plan) => plan.reason !== reason);
  }
  saveState();
  render();
}

function savePlan(btn) {
  const reason = btn.dataset.reason;
  const card = btn.closest("[data-plan-reason]");
  if (!card || !reason) return;
  const error = card.querySelector(".error");
  const accountId = card.querySelector(".plan-account")?.value || "";
  const amount = parseAmount(card.querySelector(".plan-amount")?.value);
  const show = (message) => {
    if (!error) return;
    error.hidden = !message;
    error.textContent = message || "";
  };
  if (!accountId) return show("출금 예정 계좌를 선택해 주세요.");
  if (!(amount > 0)) return show("계획 금액을 입력해 주세요.");
  const account = findAccount(accountId);
  if (!account) return show("계좌를 다시 선택해 주세요.");
  const existing = findPlan(reason);
  const normalized = normalizeAmount(amount, account.currency);
  if (existing) {
    existing.accountId = accountId;
    existing.amount = normalized;
  } else {
    state.plans.push({ id: uid(), reason, accountId, amount: normalized });
  }
  saveState();
  render();
}

function clearPlan(reason) {
  state.plans = state.plans.filter((plan) => plan.reason !== reason);
  saveState();
  render();
}

function saveStatsRate() {
  const rate = parseAmount(document.getElementById("stats-rate")?.value);
  if (!(rate > 0)) return;
  state.statsRate = rate;
  saveState();
  render();
}

function toggleEditMode() {
  state.editMode = !state.editMode;
  saveState();
  render();
}

function openEditDeposit(txId) {
  const tx = state.transactions.find((item) => item.id === txId);
  const account = tx ? findAccount(tx.accountId) : null;
  if (!tx || tx.type !== "deposit" || !account) return;
  openSheet(
    "입금 금액 수정",
    `
      <div class="field"><span>계좌</span><div class="readonly">${escapeHtml(account.name)}</div></div>
      <div class="field"><span>사유</span><div class="readonly">${escapeHtml(tx.reason || "")}</div></div>
      ${field("입금 금액", `<input id="f-amount" inputmode="decimal" value="${escapeHtml(String(tx.amount))}" />`)}
      <p class="error" id="form-error" hidden></p>
    `,
    `
      <button class="btn btn-ghost" data-action="close-modal">취소</button>
      <button class="btn btn-primary" data-action="save-edit-deposit" data-id="${tx.id}">저장</button>
    `
  );
  document.getElementById("f-amount").focus();
}

function saveEditDeposit(txId) {
  const tx = state.transactions.find((item) => item.id === txId);
  const account = tx ? findAccount(tx.accountId) : null;
  if (!tx || !account) return closeModal();
  let amount = parseAmount(document.getElementById("f-amount").value);
  if (!(amount > 0)) return showError("입금 금액을 올바르게 입력해 주세요.");
  amount = normalizeAmount(amount, account.currency);
  const nextBalance = account.balance - tx.amount + amount;
  if (nextBalance < 0) return showError("이 금액으로 바꾸면 잔액이 부족해집니다.");
  account.balance = nextBalance;
  tx.amount = amount;
  saveState();
  closeModal();
  render();
}

function snapshotData() {
  return {
    app: "moneyflow2",
    exportedAt: new Date().toISOString(),
    data: {
      accounts: state.accounts,
      transactions: state.transactions,
      reasons: state.reasons,
      plans: state.plans,
      statsRate: state.statsRate,
      editMode: state.editMode,
    },
  };
}

function applyImportedData(raw) {
  const parsed = JSON.parse(raw);
  const source = parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  if (!source || !Array.isArray(source.accounts) || !Array.isArray(source.transactions)) {
    throw new Error("invalid");
  }
  const next = migrateState(source);
  state.accounts = next.accounts;
  state.transactions = next.transactions;
  state.reasons = next.reasons;
  state.plans = next.plans;
  state.statsRate = next.statsRate;
  state.editMode = next.editMode;
  view.page = "settings";
  view.accountId = null;
  saveState();
}

async function exportData() {
  const text = JSON.stringify(snapshotData(), null, 2);
  const name = `moneyflow2-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([text], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "머니플로우 백업" });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function importData() {
  const input = document.getElementById("restore-file");
  if (!input) return;
  input.value = "";
  input.click();
}

function restoreFromFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const raw = String(reader.result || "");
    try {
      const parsed = JSON.parse(raw);
      const source = parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
      if (!source || !Array.isArray(source.accounts) || !Array.isArray(source.transactions)) {
        throw new Error("invalid");
      }
      pendingImport = raw;
      openSheet(
        "데이터 복원",
        `<p>선택한 파일로 현재 저장된 계좌, 거래, 사유, 지출계획을 모두 바꿉니다. 복원할까요?</p>`,
        `
          <button class="btn btn-ghost" data-action="close-modal">취소</button>
          <button class="btn btn-danger" data-action="confirm-import">복원</button>
        `
      );
    } catch {
      pendingImport = null;
      openSheet(
        "복원 실패",
        `<p class="error">머니플로우 JSON 파일이 아닙니다. 내보내기한 파일을 선택해 주세요.</p>`,
        `<button class="btn btn-primary" data-action="close-modal">확인</button>`
      );
    }
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!pendingImport) return closeModal();
  try {
    applyImportedData(pendingImport);
    pendingImport = null;
    closeModal();
    render();
  } catch {
    pendingImport = null;
    openSheet(
      "복원 실패",
      `<p class="error">파일을 적용하지 못했습니다.</p>`,
      `<button class="btn btn-primary" data-action="close-modal">확인</button>`
    );
  }
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
  if (action === "tab-dashboard" || action === "go-home") {
    view.page = "dashboard";
    view.accountId = null;
    render();
    return;
  }
  if (action === "tab-accounts" || action === "go-accounts") {
    view.page = "accounts";
    view.accountId = null;
    render();
    return;
  }
  if (action === "tab-settings" || action === "go-settings") {
    view.page = "settings";
    view.accountId = null;
    render();
    return;
  }
  if (action === "open-reasons") {
    view.page = "reasons";
    render();
    return;
  }
  if (action === "open-plans") {
    view.page = "plans";
    render();
    return;
  }
  if (action === "toggle-edit-mode") return toggleEditMode();
  if (action === "open-edit-deposits") {
    view.page = "edit-deposits";
    render();
    return;
  }
  if (action === "edit-deposit") return openEditDeposit(btn.dataset.id);
  if (action === "export-data") return exportData();
  if (action === "import-data") return importData();
  if (action === "add-reason") return addReason(btn.dataset.kind);
  if (action === "delete-reason") return deleteReason(btn.dataset.kind, btn.dataset.reason);
  if (action === "save-plan") return savePlan(btn);
  if (action === "clear-plan") return clearPlan(btn.dataset.reason);
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

app.addEventListener("change", (event) => {
  if (event.target.id === "stats-rate") saveStatsRate();
  if (event.target.id === "restore-file") restoreFromFile(event.target);
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
  if (action === "save-edit-deposit") return saveEditDeposit(btn.dataset.id);
  if (action === "confirm-import") return confirmImport();
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

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const kind = event.target.id?.startsWith("reason-new-") ? event.target.id.replace("reason-new-", "") : "";
  if (!kind) return;
  event.preventDefault();
  addReason(kind);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

render();
