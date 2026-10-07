import { getAddress } from "viem";
import { z } from "zod";
import { StatusResponseSchema } from "@/integration/guardian/contracts";
import { RiskLabSnapshotSchema } from "@/modules/eth-risk/risk-lab";
import {
  exportReport,
  guardianReport,
  guardianSessionReport,
  parseReportFile,
  reportHash,
  researchReport,
} from "@/modules/attestation/report";
import {
  confirmTransaction,
  connectMetaMask,
  deployRegistry,
  getMetaMask,
  publishHash,
  transactionUrl,
  verifyOnChain,
  walletMessage,
} from "@/modules/attestation/bot-chain";
import {
  esc,
  pageHead,
  badge,
  panel,
  rawDetails,
  request,
  lifecycle,
  mountIdentity,
} from "../ui.js";
import { downloadFile } from "../fingerprint/nft.js";
const keys = {
  pending: "xjy:bot:pending:v1",
  report: "xjy:bot:report:v1",
  contract: "xjy:bot:registry:968",
};
const JobSchema = z.object({
  kind: z.enum(["DEPLOY", "PUBLISH"]),
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  publisher: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  contract: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  reportHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});
export async function mount(root) {
  const life = lifecycle(root);
  let mode =
      new URLSearchParams(location.search).get("source") === "guardian"
        ? "guardian"
        : "research",
    monitor,
    eventId = "",
    envelope,
    account,
    publisher = "",
    job,
    lastTx,
    busy = false,
    contract = process.env.NEXT_PUBLIC_BOT_REPORT_REGISTRY || "",
    notice = "固定报告后，使用测试 BOT 发布内容哈希。",
    error = "",
    verification = "",
    storageBlocked = false;
  try {
    const saved = localStorage.getItem(keys.report);
    if (saved) {
      envelope = parseReportFile(saved).envelope;
      publisher = envelope.anchor?.publisher || "";
    }
    const pending = localStorage.getItem(keys.pending);
    if (pending) {
      job = JobSchema.parse(JSON.parse(pending));
      lastTx = job;
      notice = "有待核验交易，请查询原交易，不要重复发送。";
    }
    contract ||= localStorage.getItem(keys.contract) || "";
  } catch {
    error =
      "浏览器记录无法解析，请保留原始记录并检查；当前禁止新交易，避免重复广播。";
    storageBlocked = true;
  }
  root.innerHTML =
    pageHead(
      "报告存证",
      "固定调查证据和分析结果，将内容哈希发布至 BOT Chain。与指纹 NFT 共享网络，使用各自独立的合约。",
      "BOT Chain Testnet · 968",
    ) +
    `<div class="notice">存证证明内容完整性，不为事实或研究结论背书。Mock / Fork / 实时来源随报告保留；此页不会触发 Guardian 交易。</div><div class="workspace-grid">${panel("准备报告", `<label>报告来源<select id="report-source"><option value="research">ETH Risk Lab 研究快照</option><option value="guardian">Guardian 已有运行或事件</option></select></label><div id="guardian-source" ${mode === "guardian" ? "" : "hidden"}><button class="button-secondary" data-report="load-events">读取已有事件</button><label>运行或事件<select id="report-event"><option value="">先读取已有记录</option></select></label></div><div class="action-row"><button class="button-primary" data-report="prepare">固定报告并计算哈希</button><label class="file-button">导入 JSON<input id="report-file" type="file" accept=".json,application/json"></label></div><div id="report-preview"></div>`)}${panel("发布到 BOT Chain", `<p>链 968 / Gas：测试 BOT。部署与发布均需钱包单独确认。</p><button class="button-primary" data-report="connect">连接 MetaMask</button><p id="report-account" class="note"></p><label>报告存证合约地址<input id="report-contract" placeholder="0x…" spellcheck="false" value="${esc(contract)}"></label><div class="action-row"><button class="button-primary" data-report="publish">发布报告哈希</button><button class="button-secondary" data-report="settle">查询原交易</button></div><details class="raw-details"><summary>首次使用：部署报告存证合约</summary><p>此合约只存报告哈希，不是指纹 NFT 合约。已有地址时无需重复部署。</p><button class="button-secondary" data-report="deploy">通过 MetaMask 部署</button></details><p id="report-progress" role="status"></p><p id="report-tx"></p>`, "dark-panel")}${panel("独立核验", `<p>导入报告并重新计算哈希。正文、证据、数组顺序和数值变更会影响结果；对象键顺序与缩进不影响。</p><label>预期发布者<input id="report-publisher" value="${esc(publisher)}" spellcheck="false" placeholder="0x…"></label><button class="button-primary" data-report="verify">重新计算并查询链上记录</button><p id="report-verification" role="status"></p>`, "wide")}</div><p id="report-error" class="error-band" role="alert" hidden></p><p class="note">报告 JSON 保存在本机浏览器，可下载保存；链上不上传报告正文。</p>`;
  const find = (s) => root.querySelector(s);
  find("#report-source").value = mode;
  const intact = () =>
    !!envelope && reportHash(envelope.report) === envelope.reportHash;
  function controls() {
    if (!life.alive) return;
    root
      .querySelectorAll("button,input,select")
      .forEach((el) => (el.disabled = busy));
    const disable = (action, value) =>
      (find(`[data-report="${action}"]`).disabled = busy || value);
    disable(
      "publish",
      storageBlocked || !!job || !account || !contract || !intact(),
    );
    disable("deploy", storageBlocked || !!job || !account);
    disable("settle", !job);
    disable("verify", !envelope || !publisher || !contract);
    disable("prepare", !!job);
    disable("load-events", !!job);
    find("#report-source").disabled = busy || !!job;
    find("#report-event").disabled = busy || !!job;
    find("#report-file").disabled = busy || !!job;
    find("#report-contract").disabled = busy || !!job;
    find("#report-account").textContent = account || "尚未连接钱包";
    find("#report-progress").textContent = notice;
    find("#report-verification").textContent = verification;
    find("#report-error").hidden = !error;
    find("#report-error").textContent = error;
    find("#report-tx").innerHTML = lastTx
      ? `<a class="external-link" href="${transactionUrl(lastTx.hash)}" target="_blank" rel="noopener noreferrer">查看 BOT 交易 ↗</a><br><code>${esc(lastTx.hash)}</code>`
      : "";
  }
  function preview() {
    if (!life.alive) return;
    find("#report-preview").innerHTML = envelope
      ? `<div class="report-preview">${badge(envelope.report.dataMode)}<h3>${esc(envelope.report.kind)}</h3><p>快照 ${esc(envelope.report.capturedAt)}</p><code>${esc(reportHash(envelope.report))}</code><p>${intact() ? "内容哈希一致" : "内容或声明哈希已改变；禁止发布"}</p><button class="button-secondary" data-report="download">下载${envelope.anchor ? "含存证回执的 " : ""}JSON</button>${rawDetails(envelope.report)}</div>`
      : "";
    controls();
  }
  function save(value) {
    envelope = value;
    verification = "";
    try {
      localStorage.setItem(keys.report, JSON.stringify(value));
    } catch {
      error = "报告未能保存到浏览器，请立即下载 JSON。";
    }
    preview();
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    error = "";
    verification = "";
    controls();
    try {
      await fn();
    } catch (e) {
      error = walletMessage(e);
      notice = "操作未完成；已经广播的交易仍按原哈希查询，不自动重发。";
    } finally {
      busy = false;
      controls();
    }
  }
  async function loadEvents() {
    monitor = await request("/api/monitor", StatusResponseSchema, {
      signal: life.signal,
    });
    if (!life.alive) return;
    eventId = monitor.latestSession
      ? "latest-session"
      : monitor.events[0]?.id || "";
    find("#report-event").innerHTML =
      `<option value="">选择已有记录</option>${monitor.latestSession ? '<option value="latest-session">最近一次运行（未附配置版本）</option>' : ""}${monitor.events.map((e) => `<option value="${esc(e.id)}">${esc(e.createdAt)} / ${esc(e.status)}</option>`).join("")}`;
    find("#report-event").value = eventId;
    if (!eventId) notice = "暂无 Guardian 运行记录，可先准备研究快照。";
  }
  async function prepare() {
    if (mode === "research")
      save(
        exportReport(
          researchReport(
            await request("/api/eth-risk", RiskLabSnapshotSchema, {
              signal: life.signal,
            }),
          ),
        ),
      );
    else if (eventId === "latest-session" && monitor?.latestSession)
      save(
        exportReport(
          guardianSessionReport(monitor.latestSession, monitor.mode),
        ),
      );
    else {
      const event = monitor?.events.find((e) => e.id === eventId);
      if (!event) throw new Error("先读取并选择一个已有事件。");
      save(exportReport(guardianReport(event, monitor.mode)));
    }
    notice = "报告快照已固定，市场刷新不会改变待存证内容。";
  }
  async function settle(pending, wait) {
    try {
      const result = await confirmTransaction(pending, wait);
      contract = result.contract;
      job = undefined;
      try {
        localStorage.setItem(keys.contract, contract);
        localStorage.removeItem(keys.pending);
      } catch {}
      if (life.alive) find("#report-contract").value = contract;
      if (result.anchor) {
        if (envelope && reportHash(envelope.report) === pending.reportHash)
          save({ ...envelope, anchor: result.anchor });
        publisher = result.anchor.publisher;
        if (life.alive) find("#report-publisher").value = publisher;
        notice = `存证已确认：${pending.reportHash}。发布者 ${publisher}。请下载回执 JSON。`;
      } else notice = `部署已确认：${contract}。可以发布报告。`;
    } catch (e) {
      if (e instanceof Error && e.message === "TRANSACTION_REVERTED") {
        job = undefined;
        try {
          localStorage.removeItem(keys.pending);
        } catch {}
        throw e;
      }
      notice =
        "尚未取得可核验的成功回执。保留原交易哈希，稍后查询；不会自动重发。";
    }
  }
  async function send(kind) {
    if (!account || job || storageBlocked)
      throw new Error("请连接钱包；有待核验记录时仅查询原交易。");
    if (kind === "PUBLISH" && !intact())
      throw new Error("内容哈希不匹配，不能发布。");
    notice = "请在钱包中核对 BOT 测试网与费用。";
    controls();
    const pending =
      kind === "DEPLOY"
        ? await deployRegistry(getMetaMask(), account)
        : await publishHash(
            getMetaMask(),
            account,
            contract,
            reportHash(envelope.report),
          );
    job = pending;
    lastTx = pending;
    try {
      localStorage.setItem(keys.pending, JSON.stringify(pending));
    } catch {
      error = "待确认记录未保存，请保留交易哈希，避免重复签名。";
    }
    notice = "交易已广播，正在等待回执。";
    controls();
    await settle(pending, true);
  }
  async function verify() {
    if (!envelope) throw new Error("请先准备或导入报告。");
    if (!intact()) {
      verification = "内容与声明哈希不一致，未查询链上。";
      return;
    }
    const hash = reportHash(envelope.report),
      result = await verifyOnChain(contract, publisher, hash);
    if (!result.exists) {
      verification = "未找到该发布者对该内容哈希的记录。";
      return;
    }
    const anchor = envelope.anchor;
    if (anchor) {
      if (
        getAddress(anchor.contract) !== result.contract ||
        getAddress(anchor.publisher) !== result.publisher ||
        anchor.timestamp !== result.timestamp
      )
        throw new Error("文件的存证元数据与链上记录不一致。");
      await confirmTransaction({
        kind: "PUBLISH",
        hash: anchor.transactionHash,
        publisher: result.publisher,
        contract: result.contract,
        reportHash: hash,
      });
    }
    verification = `核验通过：内容哈希与链上记录一致${anchor ? "，回执也匹配" : ""}。发布者 ${result.publisher}；时间 ${new Date(Number(result.timestamp) * 1000).toISOString()}。`;
  }
  life.on("input", (e) => {
    if (e.target.id === "report-contract") contract = e.target.value.trim();
    if (e.target.id === "report-publisher") publisher = e.target.value.trim();
    verification = "";
    controls();
  });
  life.on("change", (e) => {
    if (e.target.id === "report-source") {
      mode = e.target.value;
      find("#guardian-source").hidden = mode !== "guardian";
    }
    if (e.target.id === "report-event") eventId = e.target.value;
    if (e.target.id === "report-file") {
      const file = e.target.files?.[0];
      if (file)
        void action(async () => {
          if (file.size > 2_000_000) throw new Error("报告不能超过 2 MB。");
          let parsed;
          try {
            parsed = parseReportFile(await file.text());
          } catch {
            throw new Error(
              "报告 JSON 无效，可能存在重复字段、损坏或不合法内容。",
            );
          }
          save(parsed.envelope);
          if (envelope.anchor) {
            contract = envelope.anchor.contract;
            publisher = envelope.anchor.publisher;
            find("#report-contract").value = contract;
            find("#report-publisher").value = publisher;
          }
          notice = parsed.matches
            ? "文件哈希一致，仍需链上核验。"
            : "文件内容与声明哈希不一致，禁止发布。";
        });
      e.target.value = "";
    }
    controls();
  });
  life.on("click", (e) => {
    const b = e.target.closest("[data-report]");
    if (!b || b.disabled) return;
    if (b.dataset.report === "download") {
      downloadFile(
        `risk-report-${envelope.reportHash.slice(2, 14)}.json`,
        JSON.stringify(envelope, null, 2),
        "application/json",
      );
      return;
    }
    const actions = {
      "load-events": loadEvents,
      prepare,
      connect: async () => {
        account = await connectMetaMask(getMetaMask());
        publisher ||= account;
        find("#report-publisher").value = publisher;
        notice = "钱包已连接，发布时仍需单独确认。";
      },
      publish: () => send("PUBLISH"),
      deploy: () => send("DEPLOY"),
      settle: () => settle(job, false),
      verify,
    };
    void action(actions[b.dataset.report]);
  });
  let provider;
  const changed = () => {
    account = undefined;
    notice = "钱包账户已变化，请重新连接；旧交易按原发布者核验。";
    controls();
  };
  const networkChanged = () => {
    verification = "";
    controls();
  };
  try {
    provider = getMetaMask();
    provider.on?.("accountsChanged", changed);
    provider.on?.("chainChanged", networkChanged);
  } catch {}
  preview();
  const clean = mountIdentity(root);
  return () => {
    life.dispose();
    clean();
    provider?.removeListener?.("accountsChanged", changed);
    provider?.removeListener?.("chainChanged", networkChanged);
  };
}
