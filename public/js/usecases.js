import { apiGet, apiPost } from "./server.js";

const grid = document.getElementById("category-grid");
const form = document.getElementById("create-category");

function renderCategories(categories) {
  grid.innerHTML = "";
  categories.forEach(category => {
    const card = document.createElement("a");
    card.className = "bento-card";
    card.href = `app.html?category=${encodeURIComponent(category.name)}`;
    card.innerHTML = `
      <div>
        <h3>${category.name}</h3>
        <p>${category.description ?? ""}</p>
      </div>
      <span class="muted">Created ${new Date(category.createdAt).toLocaleDateString()}</span>
    `;
    grid.appendChild(card);
  });
}

async function loadCategories() {
  const { categories } = await apiGet("/apps/categories");
  renderCategories(categories);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const name = document.getElementById("category-name").value.trim();
  const description = document.getElementById("category-description").value.trim();
  if (!name) return;
  await apiPost("/apps/categories", { name, description: description || undefined });
  form.reset();
  await loadCategories();
});

loadCategories();
