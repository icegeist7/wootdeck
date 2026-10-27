// SPDX-License-Identifier: GPL-3.0-or-later
/* Local Property Inspector: all strings from devices are rendered as text. */
let socket, context, actionId, settings = {}, devices = [], profilePalettes = {}, customThemes = [], selectedTheme = '';
const profileFields = [['profile-active-background','profileActiveBackground','#ecfaff'],['profile-active-text','profileActiveText','#12222c'],['profile-inactive-background','profileInactiveBackground','#3d455b'],['profile-inactive-text','profileInactiveText','#e0f6ff'],['profile-pending-background','profilePendingBackground','#2563eb'],['profile-pending-text','profilePendingText','#ffffff']];
const byId = id => document.getElementById(id);
const send = (event, payload) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({event, context, ...(event === 'sendToPlugin' ? {action: actionId} : {}), payload}));
};
const save = () => send('setSettings', settings);
const refresh = () => send('sendToPlugin', {type: 'refresh'});

function options(element, items, selected) {
  const signature = JSON.stringify(items);
  if (element.dataset.options !== signature) {
    element.replaceChildren(...items.map(([value,text]) => new Option(text, String(value))));
    element.dataset.options = signature;
  }
  element.value = String(selected ?? '');
}

function updateCustomThemes(themes, selection) {
  customThemes = [...(themes || [])].sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'}));
  if (selection !== undefined) selectedTheme = selection;
  if (!customThemes.some(theme => theme.id === selectedTheme)) selectedTheme = '';
  options(byId('custom-theme'), [['','Choose a Custom Theme'], ...customThemes.map(theme => [theme.id,theme.name])], selectedTheme);
  for (const id of ['theme-update','theme-apply','theme-delete']) byId(id).disabled = !selectedTheme;
  if (selection !== undefined) byId('custom-theme-name').value = customThemes.find(theme=>theme.id===selectedTheme)?.name || '';
}

function update() {
  const known = devices.find(d => d.serial === settings.serial);
  const keyboards = [['', 'Choose a keyboard'], ...devices.map(d => [d.serial, `${d.name} · ${d.serial.slice(-6)}`])];
  if (settings.serial && !known) keyboards.push([settings.serial, `Disconnected · ${settings.serial.slice(-6)}`]);
  options(byId('keyboard'), keyboards, settings.serial);
  options(byId('profile'), [['','Choose a profile'], ...(known?.profiles || []).map(p => [p.slot, `P${p.slot+1} · ${p.name}`])], settings.slot);
  for (const [id,field] of [['toggle-a','toggleSlotA'],['toggle-b','toggleSlotB']]) options(byId(id),[['','Choose a profile'],...(known?.profiles || []).map(p=>[p.slot,`P${p.slot+1} · ${p.name}`])],settings[field]);
  const active = known?.profiles.find(p => p.slot === known.activeSlot);
  byId('status').textContent = known?.ready ? `Connected · ${active?.name || 'Profile '+((known.activeSlot ?? 0)+1)}` : 'Keyboard disconnected or unavailable';
  byId('details').textContent = known ? `${known.name} · Firmware ${known.firmware || 'unknown'}${known.writable ? '' : ' · Profile writes not validated'}` : '';
  if (known?.error) byId('error').textContent = known.error;
}

function applySettings() {
  byId('label').value = settings.label || '';
  byId('font-family').value = ['segoe','bahnschrift','arial','verdana','tahoma','consolas'].includes(settings.fontFamily) ? settings.fontFamily : 'theme';
  byId('text-color-mode').value = settings.textColorMode === 'custom' ? 'custom' : 'theme';
  byId('text-color-group').classList.toggle('hidden', settings.textColorMode !== 'custom');
  byId('text-color').value = /^#[0-9a-f]{6}$/i.test(settings.textColor || '') ? settings.textColor : '#ffffff';
  byId('font-weight').value = settings.fontWeight === 'normal' ? 'normal' : 'bold';
  byId('animation-mode').value = ['none','fade','crossfade'].includes(settings.animation) ? settings.animation : 'crossfade';
  byId('animation-options').classList.toggle('hidden', byId('animation-mode').value==='none');
  byId('animation-duration').value = Number.isFinite(settings.animationDuration) ? Math.max(100,Math.min(1500,settings.animationDuration)) : 200;
  byId('animate-state').checked = settings.animateState !== false;
  byId('animate-press').checked = settings.animatePress === true;
  byId('direction').value = settings.direction === -1 ? '-1' : '1';
  byId('long-direction').value = settings.longDirection===1?'1':settings.longDirection===-1?'-1':settings.direction===-1?'1':'-1';
  byId('long-press-ms').value=Number.isFinite(settings.longPressMs)?Math.max(200,Math.min(2000,settings.longPressMs)):500;
  byId('order').value = settings.order || '';
  byId('theme').value = ['amber','copper','ice','icewhite','mint','mono','rose','violet'].includes(settings.theme) ? settings.theme : 'icewhite';
  byId('box-theme').value = ['corners','top-bottom','left-right'].includes(settings.boxTheme) ? settings.boxTheme : 'solid';
  const solidBox = byId('box-theme').value === 'solid';
  byId('box-pixels-label').textContent = solidBox ? 'Corner radius (px)' : 'Border thickness (px)';
  byId('box-pixels').min = solidBox ? '0' : '0.5';
  byId('box-pixels').max = solidBox ? '10' : '6';
  byId('box-pixels').value = Number.isFinite(settings.boxPixels) ? Math.max(solidBox ? 0 : 0.5, Math.min(solidBox ? 10 : 6,settings.boxPixels)) : solidBox ? 3.5 : 2;
  byId('box-pixels-hint').textContent = solidBox ? 'Solid: corner radius, 0–10 px. Default: 3.5 px.' : 'Borders: line thickness, 0.5–6 px. Default: 2 px. Pixels refer to standard 72-pixel keys.';
  byId('profile-color-mode').value = settings.profileColorMode === 'custom' ? 'custom' : 'theme';
  byId('profile-custom-colors').classList.toggle('hidden', settings.profileColorMode !== 'custom');
  const palette = profilePalettes[byId('theme').value] || {};
  byId('background-mode').value = settings.backgroundMode === 'custom' ? 'custom' : 'theme';
  byId('background-color-group').classList.toggle('hidden', settings.backgroundMode !== 'custom');
  byId('background-color').value = /^#[0-9a-f]{6}$/i.test(settings.backgroundColor || '') ? settings.backgroundColor : palette.background || '#000000';
  byId('active-background-mode').value = settings.activeBackgroundMode === 'custom' ? 'custom' : 'inherit';
  byId('active-background-color-group').classList.toggle('hidden', settings.activeBackgroundMode !== 'custom');
  byId('active-background-color').value = /^#[0-9a-f]{6}$/i.test(settings.activeBackgroundColor || '') ? settings.activeBackgroundColor : settings.backgroundMode === 'custom' ? byId('background-color').value : palette.background || '#000000';
  for (const [id,field,fallback] of profileFields) byId(id).value = /^#[0-9a-f]{6}$/i.test(settings[field] || '') ? settings[field] : palette[field] || fallback;
  byId('peak-group').classList.toggle('hidden', settings.keyMode === 'any');
  byId('show-peak').checked = settings.showPeak === true;
  byId('peak-reset-group').classList.toggle('hidden', settings.showPeak !== true);
  byId('peak-reset').value = Number.isFinite(settings.peakResetSeconds) && settings.peakResetSeconds>=0 && settings.peakResetSeconds<=3600 ? settings.peakResetSeconds : 0;
  byId('depth-unit').value = settings.depthUnit === 'mm' ? 'mm' : 'percent';
  byId('full-travel').value = Number.isFinite(settings.fullTravelMm) && settings.fullTravelMm>=0.1 && settings.fullTravelMm<=10 ? settings.fullTravelMm : 4;
  byId('travel-group').classList.toggle('hidden', settings.depthUnit !== 'mm');
  byId('show-threshold').checked = settings.showThreshold !== false;
  byId('threshold-marker-colors').classList.toggle('hidden',settings.showThreshold===false);
  byId('threshold-color-mode').value=settings.thresholdColorMode==='custom'?'custom':'theme';
  byId('threshold-color-group').classList.toggle('hidden',settings.thresholdColorMode!=='custom');
  byId('threshold-color').value=/^#[0-9a-f]{6}$/i.test(settings.thresholdColor || '')?settings.thresholdColor:palette.thresholdMarker || '#646b7c';
  byId('threshold-group').classList.toggle('hidden', !needsActuation());
  updateActuation();
  const foregroundMode=depthForegroundMode();
  byId('depth-color-low-label').textContent=settings.depthBackground==='threshold'?'Before actuation point':'Color at 0%';
  byId('depth-color-high-label').textContent=settings.depthBackground==='threshold'?'At / after actuation point':'Color at 100%';
  byId('foreground-color-low-label').textContent=foregroundMode==='threshold'?'Bar before actuation point':'Bar color at 0%';
  byId('foreground-color-high-label').textContent=foregroundMode==='threshold'?'Bar at / after actuation point':'Bar color at 100%';
  byId('depth-background').value = ['two','three','threshold'].includes(settings.depthBackground) ? settings.depthBackground : 'theme';
  byId('depth-colors-group').classList.toggle('hidden', !['two','three','threshold'].includes(settings.depthBackground));
  byId('depth-color-mid-group').classList.toggle('hidden', settings.depthBackground !== 'three');
  byId('depth-foreground').value = foregroundMode;
  byId('foreground-colors-group').classList.toggle('hidden', !['two','three','threshold'].includes(foregroundMode));
  byId('foreground-color-mid-group').classList.toggle('hidden', settings.depthForeground !== 'three');
  for (const [id,field,fallback] of [['foreground-color-low','depthForegroundLow',foregroundMode==='threshold'?'#c5cbd3':'#39d98a'],['foreground-color-mid','depthForegroundMid','#ffbd4a'],['foreground-color-high','depthForegroundHigh',foregroundMode==='threshold'?'#39d98a':'#ff4059']]) {
    byId(id).value = /^#[0-9a-f]{6}$/i.test(settings[field] || '') ? settings[field] : fallback;
  }
  for (const [id,field,fallback] of [['depth-color-low','depthColorLow','#14352b'],['depth-color-mid','depthColorMid','#b77916'],['depth-color-high','depthColorHigh','#bf2942']]) {
    byId(id).value = /^#[0-9a-f]{6}$/i.test(settings[field] || '') ? settings[field] : fallback;
  }
  const key = settings.key ?? 26;
  const any = settings.keyMode === 'any';
  const idleLabel = any && actionId?.endsWith('.depth');
  byId('any-percent-group').classList.toggle('hidden', !idleLabel);
  byId('any-percent').checked = settings.showAnyKeyPercent !== false;
  byId('any-filter-group').classList.toggle('hidden', !idleLabel);
  byId('any-filter').value = ['wasd','no-modifiers','custom'].includes(settings.anyKeyFilter) ? settings.anyKeyFilter : 'all';
  byId('any-list-group').classList.toggle('hidden', settings.anyKeyFilter !== 'custom');
  byId('any-list').value = settings.anyKeyList || '';
  byId('display-label-title').textContent = idleLabel ? 'Idle screen label (optional)' : 'Custom display label (optional)';
  byId('label').placeholder = idleLabel ? 'Key Pressure' : '';
  byId('key').value = any ? 'any' : settings.keyMode === 'custom' ? 'custom' : ['26','4','22','7','44','225','224'].includes(String(key)) ? String(key) : 'custom';
  byId('custom').value = String(key);
  byId('custom-group').classList.toggle('hidden', byId('key').value !== 'custom');
  byId('key-label').value = settings.keyLabel || (key === 26 ? 'W' : '');
  byId('key-label-group').classList.toggle('hidden', any);
  byId('any-group').classList.toggle('hidden', !idleLabel);
  update();
}

window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
  const action = JSON.parse(actionInfo);
  // PI commands use its registered UUID; action.context is the key context and
  // cannot authenticate messages on the property inspector's connection.
  context = uuid;
  actionId = action.action;
  settings = action.payload.settings || {};
  const kind = actionId.split('.').pop();
  byId('action-summary').textContent = ({select:'Select Profile',cycle:'Cycle Profiles',toggle:'Toggle Profiles',current:'Current Profile',depth:'Key Depth'})[kind] || 'Action & keyboard';
  byId('depth-display-group').classList.toggle('hidden', kind !== 'depth');
  byId('depth-gradient-group').classList.toggle('hidden', kind !== 'depth');
  byId('profile-colors-group').classList.toggle('hidden', kind === 'depth');
  byId('test').classList.toggle('hidden', !['select','cycle','toggle'].includes(kind));
  for (const name of ['profile','cycle','toggle','depth']) byId(name+'-group').classList.toggle('hidden', kind !== (name === 'profile' ? 'select' : name));
  applySettings();
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => {socket.send(JSON.stringify({event: registerEvent, uuid})); refresh();};
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.event === 'didReceiveSettings') { settings = message.payload.settings; applySettings(); }
    if (message.event !== 'sendToPropertyInspector') return;
    if (message.payload.type === 'inventory') {
      updateCustomThemes(message.payload.customThemes || []);
      if (message.payload.profilePalettes && JSON.stringify(profilePalettes) !== JSON.stringify(message.payload.profilePalettes)) {
        profilePalettes = message.payload.profilePalettes;
        applySettings();
      }
      devices = message.payload.devices || [];
      if (!settings.serial && devices.length === 1) {settings = {...settings, serial: devices[0].serial, schemaVersion: 1}; save();}
      update(); updateActuation();
      if (!devices.length) byId('status').textContent = message.payload.status || 'No Wooting keyboard connected';
    }
    if (message.payload.type === 'error') byId('error').textContent = message.payload.message;
    if (message.payload.type === 'customThemes') {
      updateCustomThemes(message.payload.themes,message.payload.selectedId);
      byId('theme-message').textContent = message.payload.message || '';
      byId('error').textContent = '';
    }
    if (message.payload.type === 'anyDepth' && settings.keyMode === 'any') {
      const keys = message.payload.keys || [];
      byId('any-status').textContent = !message.payload.available ? 'Analog data unavailable' : keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'} pressed` : 'Press any key';
      byId('any-readings').replaceChildren(...keys.map(key => {
        const row = document.createElement('div'); row.className = 'key-reading';
        const label = document.createElement('span'); label.textContent = key.label;
        const bar = document.createElement('progress'); bar.max = 1; bar.value = key.value;
        const value = document.createElement('span'); value.textContent = key.display || `${Math.round(key.value*100)}%`;
        row.append(label, bar, value);
        return row;
      }));
    }
  };
  socket.onclose = () => {byId('status').textContent = 'Plugin disconnected';};
};

byId('keyboard').onchange = () => {settings = {...settings, serial: byId('keyboard').value, schemaVersion: 1}; for(const field of ['slot','profileName','toggleSlotA','toggleSlotB','toggleNameA','toggleNameB']) delete settings[field]; save(); update();};
for (const [id,slotField,nameField] of [['toggle-a','toggleSlotA','toggleNameA'],['toggle-b','toggleSlotB','toggleNameB']]) byId(id).onchange = () => {
  const profile = devices.find(d=>d.serial===settings.serial)?.profiles.find(p=>String(p.slot)===byId(id).value);
  if(profile) {settings = {...settings,[slotField]:profile.slot,[nameField]:profile.name}; save();}
};
byId('profile').onchange = () => {
  const profile = devices.find(d => d.serial === settings.serial)?.profiles.find(p => String(p.slot) === byId('profile').value);
  if (profile) {settings = {...settings, slot: profile.slot, profileName: profile.name}; save();}
};
for (const [id, field] of [['label','label'],['order','order'],['key-label','keyLabel'],['theme','theme']]) byId(id).onchange = () => {settings = {...settings, [field]: byId(id).value}; save();};
byId('font-family').onchange = () => {settings.fontFamily = byId('font-family').value; save();};
byId('text-color-mode').onchange = () => {settings.textColorMode=byId('text-color-mode').value==='custom'?'custom':'theme';if(settings.textColorMode==='custom' && !/^#[0-9a-f]{6}$/i.test(settings.textColor || '')) settings.textColor=byId('text-color').value;save();applySettings();};
byId('text-color').oninput = () => {const value=byId('text-color').value;if(/^#[0-9a-f]{6}$/i.test(value)){settings.textColor=value;save();}};
byId('font-weight').onchange = () => {settings.fontWeight = byId('font-weight').value === 'normal' ? 'normal' : 'bold'; save();};
byId('animation-mode').onchange = () => {settings.animation = ['fade','crossfade'].includes(byId('animation-mode').value) ? byId('animation-mode').value : 'none'; save(); applySettings();};
byId('animation-duration').onchange = () => {
  const value = Number(byId('animation-duration').value);
  if(Number.isFinite(value) && value>=100 && value<=1500) {settings.animationDuration = value; save();}
  applySettings();
};
for(const [id,field] of [['animate-state','animateState'],['animate-press','animatePress']]) byId(id).onchange = () => {settings[field] = byId(id).checked; save();};
byId('long-direction').onchange=()=>{settings.longDirection=Number(byId('long-direction').value)===-1?-1:1;save();};
byId('long-press-ms').onchange=()=>{const input=byId('long-press-ms'),value=Number(input.value);if(input.value!=='' && Number.isFinite(value) && value>=200 && value<=2000){settings.longPressMs=value;save();}applySettings();};
byId('direction').onchange = () => {settings.direction = Number(byId('direction').value); save();applySettings();};
byId('theme').onchange = () => {settings.theme = byId('theme').value; save(); applySettings();};
byId('box-theme').onchange = () => {settings.boxTheme = ['corners','top-bottom','left-right'].includes(byId('box-theme').value) ? byId('box-theme').value : 'solid'; save(); applySettings();};
byId('box-pixels').onchange = () => {
  const field = byId('box-pixels');
  const value = Number(field.value);
  if (field.value !== '' && Number.isFinite(value) && value >= Number(field.min) && value <= Number(field.max)) {settings.boxPixels = value; save();}
  applySettings();
};
byId('background-mode').onchange = () => {
  settings.backgroundMode = byId('background-mode').value === 'custom' ? 'custom' : 'theme';
  if (settings.backgroundMode === 'custom' && !/^#[0-9a-f]{6}$/i.test(settings.backgroundColor || '')) settings.backgroundColor = byId('background-color').value;
  save(); applySettings();
};
byId('background-color').oninput = () => {
  const value = byId('background-color').value;
  if (/^#[0-9a-f]{6}$/i.test(value)) {settings.backgroundColor = value; save();}
};
byId('active-background-mode').onchange = () => {
  settings.activeBackgroundMode = byId('active-background-mode').value === 'custom' ? 'custom' : 'inherit';
  if(settings.activeBackgroundMode === 'custom' && !/^#[0-9a-f]{6}$/i.test(settings.activeBackgroundColor || '')) settings.activeBackgroundColor = byId('active-background-color').value;
  save(); applySettings();
};
byId('active-background-color').oninput = () => {
  const value = byId('active-background-color').value;
  if(/^#[0-9a-f]{6}$/i.test(value)) {settings.activeBackgroundColor = value; save();}
};
byId('profile-color-mode').onchange = () => {settings.profileColorMode = byId('profile-color-mode').value === 'custom' ? 'custom' : 'theme'; save(); applySettings();};
for (const [id,field] of profileFields) byId(id).oninput = () => {
  const value = byId(id).value;
  if (/^#[0-9a-f]{6}$/i.test(value)) {settings = {...settings,[field]:value}; save();}
};
byId('show-peak').onchange = () => {settings.showPeak=byId('show-peak').checked;save();applySettings();};
byId('peak-reset').onchange = () => {const input=byId('peak-reset'),value=Number(input.value);if(input.value!=='' && Number.isFinite(value) && value>=0 && value<=3600) {settings.peakResetSeconds=value;save();}applySettings();};
byId('depth-unit').onchange = () => {settings.depthUnit = byId('depth-unit').value === 'mm' ? 'mm' : 'percent'; save(); applySettings();};
byId('any-percent').onchange = () => {settings.showAnyKeyPercent = byId('any-percent').checked; save();};
byId('any-filter').onchange = () => {settings.anyKeyFilter = byId('any-filter').value; save(); applySettings();};
byId('any-list').onchange = () => {settings.anyKeyList = byId('any-list').value.slice(0,512); save();};
byId('threshold-color-mode').onchange=()=>{settings.thresholdColorMode=byId('threshold-color-mode').value==='custom'?'custom':'theme';if(settings.thresholdColorMode==='custom' && !/^#[0-9a-f]{6}$/i.test(settings.thresholdColor || ''))settings.thresholdColor=byId('threshold-color').value;save();applySettings();};
byId('threshold-color').oninput=()=>{const value=byId('threshold-color').value;if(/^#[0-9a-f]{6}$/i.test(value)){settings.thresholdColor=value;save();}};
byId('show-threshold').onchange = () => {settings.showThreshold = byId('show-threshold').checked; save(); applySettings();};
byId('refresh-actuation').onclick = () => send('sendToPlugin',{type:'refreshActuation'});
byId('depth-background').onchange = () => {settings.depthBackground = ['two','three','threshold'].includes(byId('depth-background').value) ? byId('depth-background').value : 'theme'; save(); applySettings();};
byId('depth-foreground').onchange = () => {settings.depthForeground = ['two','three','threshold'].includes(byId('depth-foreground').value) ? byId('depth-foreground').value : 'theme'; save(); applySettings();};
for (const [id,field] of [['foreground-color-low','depthForegroundLow'],['foreground-color-mid','depthForegroundMid'],['foreground-color-high','depthForegroundHigh']]) byId(id).oninput = () => {
  const value = byId(id).value;
  if (/^#[0-9a-f]{6}$/i.test(value)) {settings = {...settings,[field]:value}; save();}
};
for (const [id,field] of [['depth-color-low','depthColorLow'],['depth-color-mid','depthColorMid'],['depth-color-high','depthColorHigh']]) byId(id).oninput = () => {
  const value = byId(id).value;
  if (/^#[0-9a-f]{6}$/i.test(value)) {settings = {...settings,[field]:value}; save();}
};
byId('full-travel').onchange = () => {
  const value = Number(byId('full-travel').value);
  if (Number.isFinite(value) && value>=0.1 && value<=10) {settings.fullTravelMm = value; save();}
  applySettings();
};
byId('key').onchange = () => {
  const value = byId('key').value;
  settings.keyMode = value === 'any' ? 'any' : value === 'custom' ? 'custom' : 'single';
  if (!['any','custom'].includes(value)) { settings.key = Number(value); settings.keyLabel = byId('key').selectedOptions[0].textContent; }
  save();
  applySettings();
};
byId('custom').onchange = () => {const value = Number(byId('custom').value); if (Number.isInteger(value) && value >= 0 && value <= 65535) { settings.key = value; save(); }};
byId('refresh').onclick = refresh;
byId('test').onclick = () => send('sendToPlugin', {type: 'test'});
byId('custom-theme').onchange = () => {selectedTheme=byId('custom-theme').value;updateCustomThemes(customThemes,selectedTheme);};
byId('theme-save').onclick = () => send('sendToPlugin',{type:'themeSave',name:byId('custom-theme-name').value,design:settings});
byId('theme-update').onclick = () => send('sendToPlugin',{type:'themeSave',id:selectedTheme,name:byId('custom-theme-name').value,design:settings});
byId('theme-apply').onclick = () => send('sendToPlugin',{type:'themeApply',id:selectedTheme});
byId('theme-delete').onclick = () => send('sendToPlugin',{type:'themeDelete',id:selectedTheme});
setInterval(refresh, 2000);

function updateActuation() {
  const device=devices.find(d=>d.serial===settings.serial), config=device?.actuation;
  let message='Waiting for keyboard configuration...';
  if(!device?.ready) message='Keyboard disconnected';
  else if(config?.error) message=config.error;
  else if(config && config.profileSlot===device.activeSlot && Date.now()-config.observedAt<=75000) {
    const value=config.ratios[String(settings.key ?? 26)];
    message=settings.keyMode==='any' ? `Configured points loaded for ${Object.keys(config.ratios).length} physical keys` : typeof value==='number' ? `Configured actuation: ${(value*100).toFixed(1)}% travel` : 'No unambiguous configured point for this physical key';
  }
  byId('threshold-status').textContent=message;
  byId('refresh-actuation').disabled=!device?.ready || !needsActuation();
}

function needsActuation() {return settings.showThreshold!==false || settings.depthBackground==='threshold' || depthForegroundMode()==='threshold';}

function depthForegroundMode(){return ['theme','two','three','threshold'].includes(settings.depthForeground)?settings.depthForeground:'threshold';}
