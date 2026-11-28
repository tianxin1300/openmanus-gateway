const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.join(__dirname, "..", ".github", "workflows", "deploy-jiuyibanlv-preview.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

test("就医伴侣 preview is pinned to the intended repository and Worker", () => {
  assert.match(workflow, /repository: tianxin1300\/jiuyibanlv/);
  assert.match(workflow, /name = "juyiibanlvzhinengai"/);
  assert.match(workflow, /Only a code\/\* temporary branch may be previewed/);
});

test("preview config isolates KV and CareTask DO without production config, secrets, or Cron", () => {
  const start = workflow.indexOf("cat > wrangler.preview.toml <<EOF");
  const end = workflow.indexOf("\n          EOF", start);
  assert.notEqual(start, -1, "preview-only Wrangler config heredoc must exist");
  assert.notEqual(end, -1, "preview-only Wrangler config heredoc must terminate");
  const config = workflow.slice(start, end);

  assert.match(config, /APP_ENV = "preview"/);
  assert.match(config, /binding = "KV"/);
  assert.match(config, /id = "\$PREVIEW_KV_NAMESPACE_ID"/);
  assert.match(config, /new_sqlite_classes = \["CareTask"\]/);
  assert.match(config, /name = "CARE_TASKS"/);
  assert.match(config, /class_name = "CareTask"/);
  assert.doesNotMatch(config, /6f56242d19284338b3d2332d823e412d/);
  assert.doesNotMatch(config, /\[triggers\]/);
  assert.doesNotMatch(workflow, /GEMINI_KEYS|GROQ_KEYS|OPENROUTER_KEYS|COZE_API_TOKEN|FEISHU_APP_SECRET/);
  assert.match(workflow, /--ignore-base-config/);
  assert.doesNotMatch(workflow, /wrangler deploy/);
});

test("preview smoke check reads only public API metadata and requires HTTP 200", () => {
  assert.match(workflow, /\$PREVIEW_URL\/api\/map/);
  assert.match(workflow, /test "\$HTTP_CODE" = "200"/);
  assert.match(workflow, /d\?\.ok!==true/);
  assert.match(workflow, /no patient records were requested/);
});

test("cleanup verifies Worker and KV absence, then reads back Deployment inactive", () => {
  assert.match(workflow, /Worker Preview is absent \(HTTP 404\)/);
  assert.match(workflow, /isolated KV namespace is absent \(HTTP 404\)/);
  assert.match(workflow, /state: "inactive"/);
  assert.match(workflow, /listDeploymentStatuses/);
  assert.match(workflow, /latest\.state !== "inactive"/);
});
