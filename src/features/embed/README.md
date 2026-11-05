# Embed

Planned ownership: documentation and assistant UI inside host applications. Use narrow feature entry modules for product behavior and route handlers only where a real HTTP boundary is required.

Colocate feature UI, operations, schemas, types, and queries here when implemented. Follow the ownership and dependency rules in the root AGENTS.md.

No feature implementation exists in this directory. The implemented browser context
and retrieval helpers live in [src/sdk](../../sdk/README.md); DocSyde does not ship
a packaged embedded documentation widget or assistant UI.
