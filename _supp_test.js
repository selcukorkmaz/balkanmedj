const { parseJatsXml } = require('./admin/lib/jats-parser.js');

function wrap(inner) {
  return `<?xml version="1.0"?><article article-type="research-article"
    xmlns:xlink="http://www.w3.org/1999/xlink">
    <front><article-meta>
      <title-group><article-title>T</article-title></title-group>
      ${inner.meta || ''}
    </article-meta></front>
    <body>
      <sec><title>Introduction</title><p>Hello</p></sec>
      ${inner.body || ''}
    </body>
    <back>${inner.back || ''}</back>
    ${inner.floats ? `<floats-group>${inner.floats}</floats-group>` : ''}
  </article>`;
}

const SM = (id, label, href, hrefStyle='media') => {
  const inner = {
    media: `<media xlink:href="${href}" mimetype="application" mime-subtype="pdf"/>`,
    extlink: `<caption><p><ext-link ext-link-type="uri" xlink:href="${href}">${href}</ext-link></p></caption>`,
    selfuri: `<self-uri xlink:href="${href}"/>`,
    direct: '',
    none: '',
  }[hrefStyle];
  const attr = hrefStyle==='direct' ? ` xlink:href="${href}"` : '';
  return `<supplementary-material id="${id}"${attr}>${label?`<label>${label}</label>`:''}${inner}</supplementary-material>`;
};

const cases = {
  'body sec standard title': { body:`<sec><title>Supplementary Materials</title>${SM('s1','Supplementary Figure','http://x/f.pdf')}</sec>` },
  'body sec NONSTANDARD title (Supporting Information)': { body:`<sec><title>Supporting Information</title>${SM('s1','Data S1','http://x/d.pdf')}</sec>` },
  'body sec title Additional Files': { body:`<sec><title>Additional Files</title>${SM('s1','Additional File 1','http://x/a.pdf')}</sec>` },
  'body deep nested sub-sec': { body:`<sec><title>Appendix</title><sec><title>Sub</title>${SM('s1','Appendix S1','http://x/ap.pdf')}</sec></sec>` },
  'body DIRECT (no sec)': { body:`${SM('s1','Direct Supp','http://x/dir.pdf')}` },
  'back DIRECT': { back:`${SM('s1','Back Supp','http://x/back.pdf')}` },
  'back nested in sec (sec-type)': { back:`<sec sec-type="supplementary-material"><title>Supplementary Material</title>${SM('s1','Back Sec Supp','http://x/bs.pdf')}</sec>` },
  'article-meta': { meta:`${SM('s1','Meta Supp','http://x/m.pdf')}` },
  'floats-group': { floats:`${SM('s1','Float Supp','http://x/fl.pdf')}` },
  'href via ext-link in caption': { body:`<sec><title>Supplementary Materials</title>${SM('s1','ExtLink Supp','http://x/e.pdf','extlink')}</sec>` },
  'href via direct attr': { body:`<sec><title>Supplementary Materials</title>${SM('s1','Direct attr','http://x/da.pdf','direct')}</sec>` },
  'href via self-uri': { body:`<sec><title>Supplementary Materials</title>${SM('s1','SelfUri Supp','http://x/su.pdf','selfuri')}</sec>` },
  'inline-supplementary-material': { body:`<sec><title>Supplementary Materials</title><supplementary-material id="s1"><label>Inline</label><inline-supplementary-material xlink:href="http://x/in.pdf"/></supplementary-material></sec>` },
  'label trailing colon': { body:`<sec><title>Supplementary Materials</title>${SM('s1','Supplementary Data:','http://x/c.pdf')}</sec>` },
  'NO label': { body:`<sec><title>Supplementary Materials</title>${SM('s1','','http://x/nolabel.pdf')}</sec>` },
  'multiple items': { body:`<sec><title>Supplementary Materials</title>${SM('s1','One','http://x/1.pdf')}${SM('s2','Two','http://x/2.pdf')}</sec>` },
};

(async () => {
  for (const [name, inner] of Object.entries(cases)) {
    try {
      const r = await parseJatsXml(wrap(inner));
      const s = r.supplementary || [];
      const ok = s.length >= 1 && s.every(x => x.href);
      console.log(`${ok?'PASS':'FAIL'} | ${name} | count=${s.length} | ` + s.map(x=>`[${x.label||'∅'}→${x.href||'NOHREF'}]`).join(' '));
    } catch (e) {
      console.log(`ERROR | ${name} | ${e.message}`);
    }
  }
})();
