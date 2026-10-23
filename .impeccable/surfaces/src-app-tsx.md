---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/WorkspaceGate.tsx","src/Dashboard.tsx","src/OrderForm.tsx","src/ProductionWorkspace.tsx","src/TeamAccess.tsx","src/ShopSettings.tsx"]
---

Scope: the whole team app (Painel, Encomendas, Produção, Pedidos do site, Clientes, Loja, Equipe, login, order form). Visitor mode: operate, all day, every day. Devices: phone at the counter (attendant answering WhatsApp), tablet on the kitchen bench (production), computer in the office (owner).

Job: know what is due today, tomorrow and this week; open, edit and advance orders; turn site requests into orders; collect deposits; let the kitchen see what to make. Constraints: per-person financial access enforced by the server, production without finance sees no values, no invented data, every existing behaviour preserved.

## Direction contract

THESIS: the shop's week as one living list, grouped Hoje / Amanhã / Esta semana / Depois, with the selected order open beside it. Refuses the old split between "Agenda" and "Encomendas" and the generic admin dashboard grid.

OWN-WORLD: the public order page's world carried inside: chocolate #392317 rail and bars, cream #FAF7F0 ground, surface cards with 16–20px radius, gold #936326 for selection and money, leaf #2f5440 for done and deposit noted, terracotta for cancel. Gloock for headings, customer names and money; Onest for everything else, tabular numerals. Status as pill + text, never colour alone.

STORY: the attendant opens the app, sees today's pickups and deliveries in time order with deposit state, taps one, sends the WhatsApp confirmation, advances the stage; the kitchen sees tickets of what to make; the owner checks the Painel.

FIRST VIEWPORT: desktop/tablet: chocolate left rail with badge logo and nav; search and stage filter on top of the grouped list; the selected order's detail in a right pane with stage control, WhatsApp, print, edit. Phone: the grouped list full width, bottom tab bar (Painel, Encomendas, Produção, Site, Mais), detail opens full screen with a back control.

FORM: candidate 5 of 7 (grouped list with master-detail; kitchen tickets on Produção), seed:60b16ddb1ccac7fe

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
