export function createControlPanel(container, config) {
  const keyRows = [
    ["ArrowUp", "??"],
    ["ArrowLeft", "??"],
    ["ArrowRight", "??"],
    ["Q", "????"],
    ["E", "????"],
    ["A", "????"],
    ["D", "????"],
    ["Z", "????"],
    ["C", "????"],
    ["W", "?????"],
    ["X", "?????"],
    ["Shift", "???"],
    ["S", "?? 3 ???"],
  ];

  container.innerHTML = `
    <section class="panel-section">
      <p class="panel-eyebrow">Control Map</p>
      <h2>????</h2>
      <ul class="instruction-list">
        ${config.instructions.map((item) => `<li>${item}</li>`).join('')}
      </ul>
    </section>
    <section class="panel-section">
      <p class="panel-eyebrow">Activity Range</p>
      <h2>??????</h2>
      <div class="range-grid">
        ${Object.entries(config.limits)
          .map(
            ([key, value]) => `
              <div class="range-card">
                <span>${key}</span>
                <strong>${value.min}? - ${value.max}?</strong>
                <small>?? ${value.initial}? / ?? ${value.step}?</small>
              </div>
            `
          )
          .join('')}
      </div>
    </section>
    <section class="panel-section">
      <p class="panel-eyebrow">Live Keys</p>
      <div class="key-grid">
        ${keyRows
          .map(
            ([key, label]) => `
              <div class="key-card" data-key-card="${key.toLowerCase()}">
                <kbd>${key}</kbd>
                <span>${label}</span>
              </div>
            `
          )
          .join('')}
      </div>
    </section>
  `;

  const keyCards = new Map();
  container.querySelectorAll('[data-key-card]').forEach((node) => {
    keyCards.set(node.dataset.keyCard, node);
  });

  function setKeyActive(key, active) {
    const normalized = key.toLowerCase();
    const card = keyCards.get(normalized);
    if (card) {
      card.classList.toggle('active', active);
    }
  }

  return { setKeyActive };
}
