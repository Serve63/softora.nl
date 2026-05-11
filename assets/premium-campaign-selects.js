(function (global, document) {
  const CAMPAIGN_SERVICE_LOCK_OPTION_VALUES = new Set(['voice_software', 'business_software', 'ai_chatbots']);

  function closeCustomSelects(exceptShell = null) {
    document.querySelectorAll('.select-shell.open').forEach(shell => {
      if (shell === exceptShell) return;
      shell.classList.remove('open');
      shell.classList.remove('open-up');
      const field = shell.closest('.field');
      if (field) field.classList.remove('is-open');
      const trigger = shell.querySelector('.select-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function createCampaignServiceLockElement() {
    const wrap = document.createElement('span');
    wrap.className = 'select-option-lock';
    wrap.setAttribute('aria-hidden', 'true');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    const shackle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('x', '5');
    body.setAttribute('y', '11');
    body.setAttribute('width', '14');
    body.setAttribute('height', '10');
    body.setAttribute('rx', '2');
    body.setAttribute('ry', '2');
    icon.append(shackle, body);
    wrap.appendChild(icon);
    return wrap;
  }

  function createCampaignSelectOptionLabel(text) {
    const label = document.createElement('span');
    label.className = 'select-option-label';
    label.textContent = text;
    return label;
  }

  function syncCustomSelect(select) {
    const shell = select.parentElement && select.parentElement.classList.contains('select-shell')
      ? select.parentElement
      : null;
    if (!shell) return;
    const triggerLabel = shell.querySelector('.select-trigger-label');
    const activeOption = select.options[select.selectedIndex];
    if (triggerLabel) triggerLabel.textContent = activeOption ? activeOption.textContent : '';
    shell.querySelectorAll('.select-option').forEach(optionButton => {
      optionButton.classList.toggle('is-active', optionButton.dataset.value === select.value);
    });
  }

  function positionCustomSelect(shell) {
    const menu = shell.querySelector('.select-menu');
    if (!menu) return;
    shell.classList.remove('open-up');
    const rect = shell.getBoundingClientRect();
    const optionCount = shell.querySelectorAll('.select-option').length;
    const estimatedHeight = Math.min((optionCount * 42) + 12, 240);
    const spaceBelow = global.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
      shell.classList.add('open-up');
    }
  }

  function enhanceCampaignSelect(select) {
    if (select.dataset.enhanced === 'true') return;
    if (String(select.dataset.nativeSelect || '').trim() === 'true') return;
    select.dataset.enhanced = 'true';

    const shell = document.createElement('div');
    shell.className = 'select-shell';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'select-trigger-label';

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.classList.add('select-trigger-icon');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '6 9 12 15 18 9');
    icon.appendChild(polyline);

    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.setAttribute('role', 'listbox');

    Array.from(select.options).forEach(option => {
      const optionValue = String(option.value || '').trim();
      const isLockedServiceOption = select.id === 'service' && CAMPAIGN_SERVICE_LOCK_OPTION_VALUES.has(optionValue);
      if (isLockedServiceOption && !option.disabled) option.disabled = true;
      const isLockedOption = Boolean(option.disabled || isLockedServiceOption);
      const optionButton = document.createElement('button');
      optionButton.type = 'button';
      optionButton.className = 'select-option';
      optionButton.dataset.value = option.value;
      optionButton.setAttribute('role', 'option');
      optionButton.disabled = isLockedOption;
      optionButton.setAttribute('aria-disabled', String(isLockedOption));

      if (isLockedServiceOption) {
        optionButton.classList.add('select-option--locked', 'is-disabled');
        optionButton.append(
          createCampaignServiceLockElement(),
          createCampaignSelectOptionLabel(String(option.textContent || '').trim())
        );
      } else {
        optionButton.textContent = option.textContent;
      }

      if (!isLockedOption) {
        optionButton.addEventListener('click', () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncCustomSelect(select);
          closeCustomSelects();
        });
      }
      menu.appendChild(optionButton);
    });

    trigger.appendChild(label);
    trigger.appendChild(icon);

    select.parentNode.insertBefore(shell, select);
    shell.appendChild(select);
    shell.appendChild(trigger);
    shell.appendChild(menu);
    select.classList.add('native-select-hidden');
    select.hidden = true;
    select.setAttribute('aria-hidden', 'true');

    trigger.addEventListener('click', () => {
      const isOpen = shell.classList.contains('open');
      closeCustomSelects(isOpen ? null : shell);
      if (!isOpen) positionCustomSelect(shell);
      shell.classList.toggle('open', !isOpen);
      const field = shell.closest('.field');
      if (field) field.classList.toggle('is-open', !isOpen);
      trigger.setAttribute('aria-expanded', String(!isOpen));
    });

    select.addEventListener('change', () => syncCustomSelect(select));
    syncCustomSelect(select);
  }

  function initCampaignSelects() {
    document.querySelectorAll('select.sel, select.mf-sel').forEach(enhanceCampaignSelect);
  }

  global.closeCustomSelects = closeCustomSelects;
  global.syncCustomSelect = syncCustomSelect;
  global.positionCustomSelect = positionCustomSelect;
  global.enhanceCampaignSelect = enhanceCampaignSelect;
  global.initCampaignSelects = initCampaignSelects;
})(window, document);
