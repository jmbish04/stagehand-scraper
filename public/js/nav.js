const links = [
  { href: "index.html", label: "Dashboard" },
  { href: "request.html", label: "Requests" },
  { href: "usecases.html", label: "Use Case Library" },
  { href: "app.html", label: "Apps" },
  { href: "docs.html", label: "Documentation" },
  { href: "api.html", label: "API Explorer" },
];

function renderNav() {
  const container = document.getElementById("app-nav");
  if (!container) return;
  const current = window.location.pathname.split("/").pop() || "index.html";
  container.innerHTML = `
    <nav>
      <div class="nav-container">
        <div class="logo">
          <strong>Stagehand Scraper</strong>
        </div>
        <div class="nav-links">
          ${links
            .map(link => {
              const isActive = current === link.href;
              return `<a class="nav-link ${isActive ? "active" : ""}" href="${link.href}">${link.label}</a>`;
            })
            .join("")}
        </div>
      </div>
    </nav>
  `;
}

document.addEventListener("DOMContentLoaded", renderNav);
