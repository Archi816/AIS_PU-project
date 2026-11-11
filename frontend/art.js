/* Flat vector illustrations for equipment cards (shown when an administrator has not uploaded a photo).
   equipmentArt(e) picks one from the title / category / inventory number. Pure strings, no external files. */
const ART = (() => {
  const N = '#0B2545', N2 = '#13315C', B = '#2563EB', L = '#BFD3FF', G = '#B8962E', W = '#fff', S = '#CBD5E1', S2 = '#94A3B8', D = '#1E293B';
  const wrap = body => `<svg viewBox="0 0 200 120" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const shadow = (cx, cy, rx) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="5" fill="#0B2545" opacity=".10"/>`;
  return {
    printer3d: wrap(`${shadow(100, 110, 60)}
      <rect x="50" y="98" width="100" height="9" rx="3" fill="${N2}"/>
      <rect x="56" y="28" width="7" height="72" rx="2" fill="${S}"/><rect x="137" y="28" width="7" height="72" rx="2" fill="${S}"/>
      <rect x="50" y="20" width="100" height="10" rx="3" fill="${N}"/>
      <rect x="60" y="50" width="80" height="5" rx="2" fill="${S2}"/>
      <rect x="90" y="44" width="22" height="18" rx="3" fill="${B}"/><path d="M97 62h8l-4 8z" fill="${G}"/>
      <rect x="68" y="88" width="64" height="8" rx="2" fill="${S2}"/><rect x="88" y="76" width="24" height="12" rx="1.5" fill="${G}"/>
      <rect x="92" y="80" width="16" height="2" fill="${W}" opacity=".5"/>
      <circle cx="150" cy="12" r="9" fill="none" stroke="${B}" stroke-width="5"/><circle cx="150" cy="12" r="2" fill="${N}"/>`),
    arduino: wrap(`${shadow(100, 112, 70)}
      <rect x="22" y="40" width="34" height="30" rx="2" fill="${S}" stroke="${S2}" stroke-width="1.5"/><rect x="28" y="46" width="22" height="18" rx="1" fill="${S2}"/>
      <rect x="20" y="82" width="30" height="20" rx="2" fill="${D}"/>
      <rect x="40" y="18" width="130" height="92" rx="9" fill="#0E8A93"/>
      <circle cx="58" cy="30" r="3" fill="${L}"/><circle cx="152" cy="30" r="3" fill="${L}"/><circle cx="58" cy="98" r="3" fill="${L}"/><circle cx="152" cy="98" r="3" fill="${L}"/>
      <rect x="62" y="21" width="86" height="8" rx="1.5" fill="${D}"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect x="${65 + i * 10.5}" y="23" width="4" height="4" fill="${G}"/>`).join('')}
      <rect x="62" y="96" width="62" height="8" rx="1.5" fill="${D}"/>${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${65 + i * 10}" y="98" width="4" height="4" fill="${G}"/>`).join('')}
      <rect x="112" y="52" width="40" height="16" rx="2" fill="${D}"/>${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${115 + i * 5.2}" y="48" width="2" height="4" fill="${S}"/><rect x="${115 + i * 5.2}" y="68" width="2" height="4" fill="${S}"/>`).join('')}
      <circle cx="82" cy="62" r="13" fill="none" stroke="${W}" stroke-width="3"/><circle cx="92" cy="62" r="13" fill="none" stroke="${W}" stroke-width="3" opacity=".0"/>
      <path d="M72 62c4-8 10-8 10 0s6 8 10 0" fill="none" stroke="${W}" stroke-width="2.4"/>
      <circle cx="56" cy="30" r="0" fill="none"/><circle cx="136" cy="84" r="4" fill="#DC2626"/><rect x="104" y="80" width="6" height="4" fill="#22A04B"/>`),
    multimeter: wrap(`${shadow(100, 114, 40)}
      <path d="M70 100C48 100 30 86 26 66" fill="none" stroke="#DC2626" stroke-width="3" stroke-linecap="round"/>
      <path d="M130 100c22 0 40-14 44-34" fill="none" stroke="${D}" stroke-width="3" stroke-linecap="round"/>
      <rect x="26" y="60" width="5" height="14" rx="2" fill="#DC2626" transform="rotate(-12 28 66)"/><rect x="170" y="58" width="5" height="14" rx="2" fill="${D}" transform="rotate(12 172 64)"/>
      <rect x="66" y="6" width="68" height="104" rx="11" fill="${G}"/><rect x="70" y="10" width="60" height="96" rx="8" fill="#E7C65A" opacity=".55"/>
      <rect x="74" y="15" width="52" height="25" rx="3" fill="#B7D7B0" stroke="${D}" stroke-width="2"/>
      <text x="121" y="36" font-family="monospace" font-size="15" font-weight="700" text-anchor="end" fill="${D}">12.46</text><text x="78" y="23" font-family="monospace" font-size="5.5" fill="${D}">DC V</text>
      <circle cx="100" cy="68" r="19" fill="${D}"/><circle cx="100" cy="68" r="13" fill="#334155"/><path d="M100 68L108 56" stroke="${W}" stroke-width="3" stroke-linecap="round"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = i * Math.PI / 4; return `<circle cx="${(100 + Math.cos(a) * 24).toFixed(1)}" cy="${(68 + Math.sin(a) * 24).toFixed(1)}" r="1.4" fill="${D}"/>`; }).join('')}
      <circle cx="84" cy="100" r="4.5" fill="${D}"/><circle cx="100" cy="100" r="4.5" fill="${D}"/><circle cx="116" cy="100" r="4.5" fill="#DC2626"/>`),
    laptop: wrap(`${shadow(100, 108, 78)}
      <rect x="44" y="14" width="112" height="74" rx="6" fill="${N}"/><rect x="50" y="20" width="100" height="62" rx="2" fill="${B}"/>
      <rect x="50" y="20" width="100" height="62" rx="2" fill="url(#lg)"/><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient></defs>
      <rect x="58" y="28" width="46" height="5" rx="2" fill="${W}" opacity=".85"/><rect x="58" y="38" width="64" height="3" rx="1.5" fill="${W}" opacity=".5"/><rect x="58" y="45" width="54" height="3" rx="1.5" fill="${W}" opacity=".5"/>
      <rect x="58" y="56" width="28" height="18" rx="2" fill="${W}" opacity=".25"/><rect x="92" y="56" width="50" height="18" rx="2" fill="${W}" opacity=".15"/>
      <path d="M30 94h140l-8 11H38z" fill="${S}"/><rect x="30" y="90" width="140" height="6" rx="3" fill="${S2}"/><rect x="88" y="97" width="24" height="3" rx="1.5" fill="${S2}"/>`),
    workstation: wrap(`${shadow(100, 110, 74)}
      <rect x="28" y="12" width="104" height="70" rx="5" fill="${N}"/><rect x="34" y="18" width="92" height="56" rx="2" fill="#E8F0FF"/>
      <rect x="34" y="18" width="92" height="12" fill="${B}"/><circle cx="40" cy="24" r="2" fill="${W}"/><circle cx="47" cy="24" r="2" fill="${W}" opacity=".7"/>
      <rect x="40" y="38" width="38" height="4" rx="2" fill="${S2}"/><rect x="40" y="46" width="62" height="4" rx="2" fill="${S}"/><rect x="40" y="54" width="50" height="4" rx="2" fill="${S}"/><rect x="40" y="62" width="30" height="4" rx="2" fill="${S}"/>
      <rect x="74" y="82" width="12" height="14" fill="${S2}"/><rect x="56" y="96" width="48" height="6" rx="3" fill="${S}"/>
      <rect x="146" y="30" width="34" height="70" rx="4" fill="${N2}"/><rect x="151" y="37" width="24" height="3" rx="1.5" fill="${S2}"/><rect x="151" y="44" width="24" height="3" rx="1.5" fill="${S2}"/>
      <circle cx="163" cy="86" r="5" fill="none" stroke="#22A04B" stroke-width="2"/>`),
    robot: wrap(`${shadow(100, 112, 56)}
      <line x1="100" y1="8" x2="100" y2="22" stroke="${S2}" stroke-width="3"/><circle cx="100" cy="8" r="5" fill="#DC2626"/>
      <rect x="72" y="22" width="56" height="34" rx="10" fill="${B}"/><rect x="80" y="30" width="40" height="18" rx="6" fill="${N}"/>
      <circle cx="91" cy="39" r="5" fill="#7DD3FC"/><circle cx="109" cy="39" r="5" fill="#7DD3FC"/>
      <rect x="64" y="58" width="72" height="36" rx="8" fill="${N2}"/><rect x="76" y="66" width="48" height="6" rx="3" fill="${G}"/><circle cx="88" cy="82" r="3" fill="#22A04B"/><circle cx="100" cy="82" r="3" fill="${L}"/><circle cx="112" cy="82" r="3" fill="#DC2626"/>
      <rect x="44" y="62" width="14" height="26" rx="6" fill="${S2}"/><rect x="142" y="62" width="14" height="26" rx="6" fill="${S2}"/>
      <circle cx="78" cy="100" r="13" fill="${D}"/><circle cx="78" cy="100" r="5" fill="${S}"/><circle cx="122" cy="100" r="13" fill="${D}"/><circle cx="122" cy="100" r="5" fill="${S}"/>`),
    raspberry: wrap(`${shadow(100, 112, 74)}
      <rect x="24" y="18" width="152" height="90" rx="8" fill="#1F9D55"/>
      <rect x="40" y="22" width="104" height="9" rx="1.5" fill="${D}"/>${Array.from({ length: 20 }, (_, i) => `<rect x="${43 + i * 5}" y="24" width="2.4" height="2.4" fill="${G}"/><rect x="${43 + i * 5}" y="27" width="2.4" height="2.4" fill="${G}"/>`).join('')}
      <rect x="146" y="38" width="34" height="28" rx="2" fill="${S}" stroke="${S2}" stroke-width="1.5"/><rect x="146" y="72" width="34" height="14" rx="2" fill="${S}" stroke="${S2}" stroke-width="1.5"/><rect x="146" y="90" width="34" height="14" rx="2" fill="${S}" stroke="${S2}" stroke-width="1.5"/>
      <rect x="64" y="46" width="40" height="40" rx="3" fill="${S}"/><rect x="70" y="52" width="28" height="28" rx="2" fill="${S2}"/><text x="84" y="71" font-family="Georgia,serif" font-size="9" text-anchor="middle" fill="${W}">BCM</text>
      <rect x="30" y="52" width="22" height="30" rx="2" fill="${D}"/><rect x="34" y="94" width="26" height="9" rx="1.5" fill="${S}"/><rect x="66" y="94" width="18" height="9" rx="1.5" fill="${D}"/>
      <circle cx="36" cy="30" r="3" fill="${L}"/><circle cx="160" cy="30" r="0" fill="none"/><circle cx="118" cy="96" r="2.4" fill="#22C55E"/><circle cx="126" cy="96" r="2.4" fill="#DC2626"/>`),
    oscilloscope: wrap(`${shadow(100, 110, 74)}
      <rect x="22" y="14" width="156" height="92" rx="9" fill="${N2}"/><rect x="30" y="22" width="92" height="70" rx="4" fill="#06140F"/>
      ${[1, 2, 3].map(i => `<line x1="30" y1="${22 + i * 17.5}" x2="122" y2="${22 + i * 17.5}" stroke="#14532D" stroke-width="1"/>`).join('')}${[1, 2, 3, 4, 5].map(i => `<line x1="${30 + i * 15.3}" y1="22" x2="${30 + i * 15.3}" y2="92" stroke="#14532D" stroke-width="1"/>`).join('')}
      <path d="M32 57c8-30 14-30 20 0s14 30 20 0 14-30 20 0 12 22 28 0" fill="none" stroke="#4ADE80" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="146" cy="38" r="11" fill="${D}"/><path d="M146 38l5-6" stroke="${S}" stroke-width="2.4" stroke-linecap="round"/><circle cx="146" cy="68" r="8" fill="${D}"/><path d="M146 68l-4-5" stroke="${S}" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="166" cy="38" r="5" fill="${G}"/><circle cx="166" cy="56" r="5" fill="${S2}"/><circle cx="166" cy="74" r="5" fill="${S2}"/>
      ${[0, 1, 2, 3].map(i => `<circle cx="${40 + i * 20}" cy="100" r="3" fill="${S}"/>`).join('')}`),
    microscope: wrap(`${shadow(100, 112, 50)}
      <rect x="62" y="102" width="76" height="9" rx="4" fill="${N2}"/>
      <path d="M118 102V52c0-22-14-34-30-34" fill="none" stroke="${N}" stroke-width="12" stroke-linecap="round"/>
      <rect x="66" y="10" width="14" height="38" rx="3" fill="${D}" transform="rotate(-18 73 29)"/><rect x="60" y="44" width="22" height="8" rx="2" fill="${S2}" transform="rotate(-18 71 48)"/>
      <rect x="64" y="56" width="10" height="22" rx="2" fill="${S}" transform="rotate(-8 69 66)"/>
      <rect x="54" y="84" width="58" height="6" rx="2" fill="${S2}"/><rect x="62" y="80" width="24" height="4" rx="1" fill="${L}"/>
      <circle cx="122" cy="62" r="6" fill="${G}"/>`),
    generic: wrap(`${shadow(100, 108, 62)}
      <rect x="34" y="40" width="132" height="62" rx="9" fill="${N2}"/><path d="M76 40v-8a6 6 0 016-6h36a6 6 0 016 6v8" fill="none" stroke="${N}" stroke-width="8"/>
      <rect x="34" y="62" width="132" height="8" fill="${N}"/><rect x="90" y="57" width="20" height="18" rx="3" fill="${G}"/><rect x="96" y="63" width="8" height="6" rx="1" fill="${N}"/>`)
  };
})();

function equipmentArt(e) {
  const t = `${e.title} ${e.category} ${e.inventoryNumber}`.toLowerCase();
  const key = /3d|print/.test(t) ? 'printer3d'
    : /arduino|ard-/.test(t) ? 'arduino'
    : /multimeter|mul-|voltmeter/.test(t) ? 'multimeter'
    : /microscop/.test(t) ? 'microscope'
    : /oscillo|\bscope\b/.test(t) ? 'oscilloscope'
    : /raspberry|rpi-|\bpi\b/.test(t) ? 'raspberry'
    : /robot|rob-/.test(t) ? 'robot'
    : /laptop|lap-|notebook/.test(t) ? 'laptop'
    : /workstation|desktop|computer|pc-/.test(t) ? 'workstation'
    : 'generic';
  return ART[key];
}
