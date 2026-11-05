# DocSyde

DocSyde keeps product documentation synchronized with product changes—for people and AI agents, so product knowledge can follow the software instead of going stale.

The demo follows a source change through grounded analysis, optional Playwright screenshots and Meta vision, product-impact interpretation, documentation proposals, and human review. Human review and explicit publication control what becomes live. Selected masked screenshots can illustrate reviewed sections inline. Published documentation is available in the product reader, host SDK, and read-only MCP interface. The SDK supplies context/retrieval helpers; host applications supply their own UI.

## Quick Start

Prerequisites: **Node.js 22.13+ (22.x LTS)**, npm, Git, Docker Desktop (running, with Compose v2), and a POSIX shell (macOS/Linux or WSL). Minimum generation setup needs GitHub repository read access and a Baseten API key for Muse Spark Open (`meta-models/muse-spark-open-1026`) text reasoning.

**Reproduce the demo with [OpenTodo](SETUP.md#separate-demo-application-opentodo)**, the public sample application already selected in `.env.example`; no project of your own is required.

```sh
git clone https://github.com/abishek1303/DocSyde.git
cd DocSyde
cp .env.example .env
npm ci
```

Edit `.env`: add `GITHUB_TOKEN` with **Contents: read** access to the sample repository and `BASETEN_API_KEY`. Keep the supplied `DOCSYDE_ANALYSIS_REPOSITORIES`, or replace it with exactly one `owner/repository`. Then, from the same directory:

```sh
npm run db:setup
npm run dev -- --hostname 127.0.0.1
```

Open **http://127.0.0.1:3000**. Put credentials only in the ignored `.env`; never in browser configuration. The database and screenshot storage are local. Compilation downloads Google Fonts, so internet access is required on the first build.

Optional: install Chromium with `npx playwright install chromium` for runtime inspection. A separate `META_API_KEY` enables Muse Spark 1.3 Vision (`muse-spark-1.3`) screenshot understanding and Muse Wonder (`muse-wonder-1.0`) editorial finalization. MCP is read-only, enabled in the example configuration, and needs no additional service or model calls; it can be disabled with `DOCSYDE_MCP_ENABLED=0`. See [SETUP.md](SETUP.md) for these integrations.

## Walk through the demo

1. Configure the repository in `.env` and grant the token read access. In **Product understanding**, use **Analyze repository** to save optional repository orientation. Human context is advisory, not evidence.
2. **New run → Full Scan** pins the selected branch and generates fresh documentation proposals from bounded current source evidence, with optional runtime inspection. **Latest Changes** analyzes the selected branch’s latest comparison; eligible saved documentation enables it, and its planner targets live publications. Neither scan publishes automatically.
3. Inspect the run, screenshots, and proposed updates. **Pending Changes → reject unwanted edits → Publish N changes** makes the included documentation live; previous live versions remain in **Archive**.
4. Open **MCP** to retrieve the same published knowledge. Pending wording is not authoritative.

Fresh databases contain no demo documents or historical runs. See [SETUP.md](SETUP.md) for initial documentation, the separate OpenTodo demo app, trusted runtime setup, optional MCP connection, and verification commands. For first-run failures, see [Troubleshooting](SETUP.md#troubleshooting).

DocSyde is a trusted **local demo**, not an authenticated public service. Keep it bound to loopback. Run one application process for analysis workflows.

## Further reading

- [Setup and optional integrations](SETUP.md)
- [Architecture](ARCHITECTURE.md)
- [Model usage and evidence boundaries](MODEL_USAGE.md)
- [SDK](src/sdk/README.md)
- [AI provider configuration](src/integrations/ai/README.md)

## License

[Apache License 2.0](LICENSE).
