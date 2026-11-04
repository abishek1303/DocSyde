# DocSyde

DocSyde keeps product documentation synchronized with product changes—for people and AI agents.

The demo follows a source change through grounded analysis, optional Playwright screenshots and Meta vision, product-impact interpretation, documentation proposals, and human review. Approval and publication are separate. Selected masked screenshots can illustrate reviewed sections inline. Published documentation is available in the product reader, host SDK, and read-only MCP interface.

## Run locally

Prerequisites: **Node.js 22.13+ LTS**, npm, Git, and Docker Desktop (running). You need GitHub repository read access and a Baseten API key for new analyses. Meta API credentials enable screenshot understanding and Muse Wonder composition. Browsing saved content and MCP make no model calls.

```sh
git clone https://github.com/abishek1303/DocSyde.git
cd DocSyde
cp .env.example .env
# Add GITHUB_TOKEN, META_API_KEY and BASETEN_API_KEY to .env.
npm ci
npm run db:setup
npx playwright install chromium
npm run dev -- --hostname 127.0.0.1
```

Open **http://127.0.0.1:3000**. Put credentials only in the ignored `.env`; never in browser configuration. The database and screenshot storage are local. Compilation downloads Google Fonts, so internet access is required on the first build.

## Walk through the demo

1. **New run → Full scan** builds and saves product understanding. Optional human context helps describe purpose and audience; it is not evidence. Full scan does **not** generate documentation.
2. **New run → Latest Changes** compares two revisions against existing saved documentation. It becomes available only when eligible documents exist.
3. Inspect the run, screenshots, and proposed updates. **Pending Changes → reject unwanted edits → Publish N changes** makes the included documentation live; previous live versions remain in **Archive**.
4. Open **MCP** to retrieve the same published knowledge. Pending wording is not authoritative.

Fresh databases contain no demo documents or historical runs. See [SETUP.md](SETUP.md) for initial documentation, the separate OpenTodo demo app, trusted runtime setup, optional MCP connection, and verification commands.

DocSyde is a trusted **local demo**, not an authenticated public service. Keep it bound to loopback. Run one application process for analysis workflows.

## Further reading

- [Setup and optional integrations](SETUP.md)
- [Architecture](ARCHITECTURE.md)
- [Model usage and evidence boundaries](MODEL_USAGE.md)
- [SDK](src/sdk/README.md)
- [AI provider configuration](src/integrations/ai/README.md)
