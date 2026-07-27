const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const normalizeCssWhitespace = (value) => value.replace(/\s+/g, ' ').trim();
const stripCssComments = (value) => value.replace(/\/\*[\s\S]*?\*\//g, '');

function findCssOpenBrace(source, start) {
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      assert.notEqual(commentEnd, -1, 'unclosed CSS comment');
      index = commentEnd + 1;
      continue;
    }
    if (character === '{') return index;
  }
  return -1;
}

function findCssCloseBrace(source, open) {
  let depth = 1;
  let quote = null;
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      assert.notEqual(commentEnd, -1, 'unclosed CSS comment');
      index = commentEnd + 1;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return index;
  }
  assert.fail('unclosed CSS block');
}

function parseCssBlocks(source) {
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (source[cursor] === '/' && source[cursor + 1] === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2);
      assert.notEqual(commentEnd, -1, 'unclosed CSS comment');
      cursor = commentEnd + 2;
      continue;
    }
    const open = findCssOpenBrace(source, cursor);
    if (open === -1) {
      assert.equal(stripCssComments(source.slice(cursor)).trim(), '', 'unexpected CSS tail');
      break;
    }
    const close = findCssCloseBrace(source, open);
    const prelude = normalizeCssWhitespace(stripCssComments(source.slice(cursor, open)));
    assert.notEqual(prelude, '', 'CSS block has an empty prelude');
    blocks.push({
      prelude,
      body: source.slice(open + 1, close),
      start: cursor,
      open,
      close,
      end: close + 1,
    });
    cursor = close + 1;
  }
  return blocks;
}

function publicContentCss(css) {
  const startMarker = '/* PUBLIC CONTENT PAGES (ABOUT / CONTACT) */';
  const endMarker = '/* ADMIN PAGES */';
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, 'public content CSS start marker');
  assert.notEqual(end, -1, 'public content CSS end marker');
  return css.slice(start + startMarker.length, end);
}

const cssSelectors = (block) => block.prelude
  .split(',')
  .map(normalizeCssWhitespace);
const cssRuleBlocks = (source) => parseCssBlocks(source)
  .filter(({ prelude }) => !prelude.startsWith('@'));
const cssDeclarations = (block) => new Map(
  block.body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const separator = declaration.indexOf(':');
      assert.notEqual(separator, -1, `invalid CSS declaration: ${declaration}`);
      return [
        declaration.slice(0, separator).trim().toLowerCase(),
        normalizeCssWhitespace(declaration.slice(separator + 1)),
      ];
    }),
);
const cssRule = (rules, selector) => {
  const matches = rules.filter((rule) => cssSelectors(rule).includes(selector));
  assert.notEqual(matches.length, 0, `missing CSS rule: ${selector}`);
  return matches;
};
const cssProperty = (rules, selector, property) => {
  let value;
  for (const rule of cssRule(rules, selector)) {
    const candidate = cssDeclarations(rule).get(property);
    if (candidate !== undefined) value = candidate;
  }
  assert.notEqual(value, undefined, `missing ${property}: ${selector}`);
  return value;
};
const cssMediaRules = (publicCss, condition) => {
  const expected = `@media ${condition}`;
  const matches = parseCssBlocks(publicCss)
    .filter(({ prelude }) => prelude === expected);
  assert.equal(matches.length, 1, `expected one ${expected} block`);
  return cssRuleBlocks(matches[0].body);
};
const cssHexVariable = (css, name) => {
  const match = css.match(new RegExp(`${name}:\\s*(#[\\da-f]{6})`, 'i'));
  assert.ok(match, `missing CSS variable: ${name}`);
  return match[1];
};
const cssResolvedColor = (css, rules, selector, property = 'color') => {
  const value = cssProperty(rules, selector, property);
  const match = value.match(/(#[\da-f]{6}|var\((--[\w-]+)\))/i);
  assert.ok(match, `missing color value for ${property}: ${selector}`);
  return match[2] ? cssHexVariable(css, match[2]) : match[1];
};
const relativeLuminance = (hex) => {
  const channels = hex.match(/[\da-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};
const contrastRatio = (foreground, background) => {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
};

function assertPublicSelectorsScoped(publicCss) {
  function walk(blocks, context) {
    for (const block of blocks) {
      if (block.prelude.startsWith('@keyframes ')) continue;
      if (block.prelude.startsWith('@')) {
        walk(parseCssBlocks(block.body), block.prelude);
        continue;
      }
      for (const selector of cssSelectors(block)) {
        assert.ok(
          selector.startsWith('.public-content-page ')
          || selector === 'body.public-content-page',
          `unscoped public selector in ${context}: ${selector}`,
        );
      }
    }
  }
  walk(parseCssBlocks(publicCss), 'public block');
}

function assertPublicResponsiveContract(publicCss) {
  const compact = cssMediaRules(publicCss, '(max-width: 979px)');
  assert.equal(
    cssProperty(compact, '.public-content-page .public-nav', 'display'),
    'none',
    '979px hides full public nav',
  );
  assert.equal(
    cssProperty(compact, '.public-content-page .public-menu', 'display'),
    'block',
    '979px shows compact public menu',
  );
  for (const selector of [
    '.public-content-page .public-hero',
    '.public-content-page .about-journey',
    '.public-content-page .about-vision',
    '.public-content-page .contact-layout',
  ]) {
    assert.equal(cssProperty(compact, selector, 'grid-template-columns'), '1fr', selector);
  }

  const narrow = cssMediaRules(publicCss, '(max-width: 660px)');
  for (const selector of [
    '.public-content-page .vision-grid',
    '.public-content-page .leadership-grid',
    '.public-content-page .public-footer-grid',
  ]) {
    assert.equal(cssProperty(narrow, selector, 'grid-template-columns'), '1fr', selector);
  }
}

function moveCssRuleOutsideMedia(publicCss, condition, selector) {
  const mediaPrelude = `@media ${condition}`;
  const media = parseCssBlocks(publicCss)
    .find(({ prelude }) => prelude === mediaPrelude);
  assert.ok(media, `missing mutation source: ${mediaPrelude}`);
  const rule = parseCssBlocks(media.body)
    .find((candidate) => cssSelectors(candidate).includes(selector));
  assert.ok(rule, `missing mutation rule: ${selector}`);

  const ruleSource = media.body.slice(rule.start, rule.end);
  const mediaBodyWithoutRule = (
    media.body.slice(0, rule.start) + media.body.slice(rule.end)
  );
  const rebuiltMedia = `${media.prelude} {${mediaBodyWithoutRule}}`;
  return (
    publicCss.slice(0, media.start)
    + rebuiltMedia
    + publicCss.slice(media.end)
    + `\n${ruleSource}\n`
  );
}

const decodeEntities = (value) => value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');
const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function parseHtml(source) {
  const document = { tagName: '#document', attributes: {}, children: [] };
  const stack = [document];
  const tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g) || [];

  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;
    if (!token.startsWith('<')) {
      stack.at(-1).children.push({
        tagName: '#text',
        attributes: {},
        children: [],
        value: token,
      });
      continue;
    }
    if (token.startsWith('</')) {
      const tagName = token.slice(2, -1).trim().toLowerCase();
      const index = stack.findLastIndex((node) => node.tagName === tagName);
      assert.notEqual(index, -1, `unexpected closing tag: ${tagName}`);
      stack.length = index;
      continue;
    }

    const match = token.match(/^<([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/);
    assert.ok(match, `unable to parse tag: ${token}`);
    const tagName = match[1].toLowerCase();
    const node = {
      tagName,
      attributes: parseAttributes(match[2]),
      children: [],
    };
    stack.at(-1).children.push(node);
    if (!voidElements.has(tagName) && match[3] !== '/') stack.push(node);
  }

  assert.equal(stack.length, 1, `unclosed tag: ${stack.at(-1).tagName}`);
  return document;
}

function findAll(node, predicate) {
  const matches = [];
  for (const child of node.children) {
    if (child.tagName !== '#text' && predicate(child)) matches.push(child);
    matches.push(...findAll(child, predicate));
  }
  return matches;
}

function findOne(node, predicate, label) {
  const matches = findAll(node, predicate);
  assert.equal(matches.length, 1, `${label}: expected one element, found ${matches.length}`);
  return matches[0];
}

function hasClass(node, className) {
  return (node.attributes.class || '').split(/\s+/).includes(className);
}

function hasAttribute(node, name) {
  return Object.hasOwn(node.attributes, name);
}

function textContent(node) {
  const value = node.tagName === '#text'
    ? node.value
    : node.children.map(textContent).join(' ');
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function visibleTextContent(node) {
  if (node.tagName === '#text') {
    return decodeEntities(node.value).replace(/\s+/g, ' ').trim();
  }
  if (
    ['script', 'style', 'template'].includes(node.tagName)
    || hasAttribute(node, 'hidden')
    || node.attributes['aria-hidden']?.toLowerCase() === 'true'
  ) {
    return '';
  }
  return node.children
    .map(visibleTextContent)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleBodyText(document) {
  const body = findOne(document, (node) => node.tagName === 'body', 'visible body');
  return visibleTextContent(body);
}

function assertExactLinks(scope, expected, label) {
  const actual = findAll(scope, (node) => node.tagName === 'a').map((link) => ({
    label: visibleTextContent(link),
    href: decodeEntities(link.attributes.href || ''),
    current: link.attributes['aria-current'] || null,
  }));
  assert.deepEqual(actual, expected, label);
}

const primaryRoutes = [
  ['Home', 'index.html'],
  ['About', 'about.html'],
  ['Portfolio', 'https://www.lumi5labs.com/portfolio/'],
  ['Blog', 'https://www.lumi5labs.com/blog/'],
  ['FAQ', 'https://www.lumi5labs.com/faq/'],
  ['Contact', 'contact.html'],
];

const authRoutes = [
  ['Sign in', 'signin.html'],
  ['Sign up', 'signup.html'],
];

const socialRoutes = [
  ['LinkedIn', 'https://www.linkedin.com/company/lumi5-labs/'],
  ['Instagram', 'https://www.instagram.com/lumi5labs/'],
  ['Bluesky', 'https://bsky.app/profile/lumi5labs.bsky.social'],
  ['Facebook', 'https://www.facebook.com/profile.php?id=61575224522339'],
];

const footerFacts = [
  'A venture studio and innovation lab based in Singapore, fueling the growth of technology startups with expert guidance and funding.',
  '1 Fullerton Rd, #02-01 One Fullerton',
  'Singapore 049213',
  'business@lumi5labs.com',
  '+65-6599-1991',
  'Copyright © 2026 LUMI5 LABS',
  'v26.02.13.1',
];

test('visible body copy excludes head, hidden and non-rendered subtrees', () => {
  const document = parseHtml(`
    <html>
      <head>
        <title>Title-only requirement</title>
      </head>
      <body>
        <main>
          <p>Visible copy</p>
          <script>Script-only copy</script>
          <style>Style-only copy</style>
          <template>Template-only copy</template>
          <p hidden>Hidden-attribute copy</p>
          <p aria-hidden="true">ARIA-hidden copy</p>
        </main>
      </body>
    </html>
  `);

  assert.equal(visibleBodyText(document), 'Visible copy');
});

test('both pages expose independently complete desktop, compact and footer shells', () => {
  const pages = [
    ['about.html', 'public-content-page about-page', 'About'],
    ['contact.html', 'public-content-page contact-page', 'Contact'],
  ];

  for (const [file, bodyClass, currentPage] of pages) {
    const source = read(file);
    const document = parseHtml(source);
    const body = findOne(document, (node) => node.tagName === 'body', `${file}: body`);
    assert.equal(body.attributes.class, bodyClass, `${file}: exact body classes`);
    assert.equal(findAll(body, (node) => node.tagName === 'h1').length, 1, `${file}: one h1`);

    const header = findOne(body, (node) => (
      node.tagName === 'header' && hasClass(node, 'public-header')
    ), `${file}: public header`);
    const desktopNav = findOne(header, (node) => (
      node.tagName === 'nav'
      && hasClass(node, 'public-nav')
      && node.attributes['aria-label'] === 'Primary navigation'
    ), `${file}: desktop navigation`);
    const expectedPrimary = primaryRoutes.map(([label, href]) => ({
      label,
      href,
      current: label === currentPage ? 'page' : null,
    }));
    assertExactLinks(desktopNav, expectedPrimary, `${file}: desktop navigation links`);

    const authActions = findOne(header, (node) => (
      node.tagName === 'div' && hasClass(node, 'public-auth-actions')
    ), `${file}: authentication actions`);
    assertExactLinks(
      authActions,
      authRoutes.map(([label, href]) => ({ label, href, current: null })),
      `${file}: authentication links`,
    );

    const compactMenu = findOne(header, (node) => (
      node.tagName === 'details' && node.attributes.class === 'public-menu'
    ), `${file}: native compact menu`);
    const summary = findOne(compactMenu, (node) => node.tagName === 'summary', `${file}: menu summary`);
    assert.equal(visibleTextContent(summary), 'Menu', `${file}: menu summary label`);
    const compactNav = findOne(compactMenu, (node) => (
      node.tagName === 'nav' && node.attributes['aria-label'] === 'Compact primary navigation'
    ), `${file}: compact navigation`);
    assertExactLinks(
      compactNav,
      [...primaryRoutes, ...authRoutes].map(([label, href]) => ({
        label,
        href,
        current: label === currentPage ? 'page' : null,
      })),
      `${file}: compact navigation links`,
    );

    const footer = findOne(body, (node) => (
      node.tagName === 'footer' && hasClass(node, 'public-footer')
    ), `${file}: footer`);
    const footerNav = findOne(footer, (node) => (
      node.tagName === 'nav' && node.attributes['aria-label'] === 'Footer navigation'
    ), `${file}: footer navigation`);
    assertExactLinks(
      footerNav,
      primaryRoutes.map(([label, href]) => ({ label, href, current: null })),
      `${file}: footer navigation links`,
    );
    const socials = findOne(footer, (node) => (
      node.tagName === 'section' && hasClass(node, 'public-socials')
    ), `${file}: footer social links`);
    assertExactLinks(
      socials,
      socialRoutes.map(([label, href]) => ({ label, href, current: null })),
      `${file}: exact social links`,
    );
    const footerContact = findOne(footer, (node) => (
      node.tagName === 'div' && hasClass(node, 'public-footer-contact')
    ), `${file}: footer contact group`);
    const footerContactHeading = findOne(
      footerContact,
      (node) => node.tagName === 'h2',
      `${file}: footer contact heading`,
    );
    assert.equal(visibleTextContent(footerContactHeading), 'Visit & contact');
    const address = findOne(footerContact, (node) => node.tagName === 'address', `${file}: footer address`);
    assert.equal(findAll(address, (node) => /^h[1-6]$/.test(node.tagName)).length, 0);
    assertExactLinks(address, [
      {
        label: '1 Fullerton Rd, #02-01 One Fullerton Singapore 049213',
        href: 'https://www.google.com/maps/search/?api=1&query=1%20Fullerton%20Rd%20Singapore%20049213',
        current: null,
      },
      { label: 'business@lumi5labs.com', href: 'mailto:business@lumi5labs.com', current: null },
      { label: '+65-6599-1991', href: 'tel:+6565991991', current: null },
    ], `${file}: footer contact links`);
    const footerText = visibleTextContent(footer);
    for (const fact of footerFacts) assert.ok(footerText.includes(fact), `${file}: ${fact}`);
    assert.doesNotMatch(source, /ai\.webp|artificial intelligence hero/i);
  }
});

test('About preserves the complete story, vision, leadership and connect copy', () => {
  const source = read('about.html');
  const text = visibleBodyText(parseHtml(source));
  const required = [
    'Ideas grow through connection.',
    'About Lumi5 Labs',
    'Our Inspiring Journey',
    'In a world where innovation knows no bounds, two visionary leaders, Raveen Beemsingh and Victor Chow, embarked on a journey to create something extraordinary. Raveen, the co-founder of Hammerhead, had already made his mark by developing cutting-edge software solutions and mentoring startups through Techstars. Meanwhile, Victor, with his extensive background in SingTel-NCS, Huawei, Fatfish Group, and InspirAsia Fintech Accelerator, had a proven track record of fostering entrepreneurship and growth.',
    'Their paths converged when they decided to establish Lumi5 Labs, a venture studio and innovation lab dedicated to investing in, nurturing, and transforming startups, small businesses, and large corporations. This collaboration was not just about combining their expertise; it was about creating a platform where their collective knowledge could empower others.',
    'Raveen brought his technical prowess and entrepreneurial spirit, while Victor contributed his strategic insights and experience in scaling businesses across diverse regions. Together, they crafted a unique ecosystem where startups could flourish and established companies could innovate. Lumi5 Labs became a beacon for those seeking to disrupt industries and redefine success.',
    'A Legacy of Innovation and Inspiration',
    'Raveen Beemsingh and Victor Chow, founders of Lumi5 Labs, aimed to create a global legacy of innovation and inspiration. Their vision extended beyond startups to a global network of innovation labs, empowering entrepreneurs and businesses.',
    'They are seeking strategic corporate partners to launch the Lumi5 Foundation, offering educational programs and investing in sustainable ventures addressing global challenges.',
    "Quarterly Lumi5 workshops brought together thought leaders and startup founders to share ideas and celebrate innovation. Their mission wasn't just about profits—it was about uplifting communities, driving sustainability, and creating lasting impact.",
    'Raveen and Victor want to transform Lumi5 Labs into a movement, inspiring future generations to innovate and shape a better world.',
    'The Team',
    'CEO & CTO',
    'Raveen Beemsingh is a 2-time exited entrepreneur and technology leader with over two decades of experience in software development and technology ventures. His entrepreneurial journey includes co-founding Hammerhead, a cycling technology company, where he served as Chief Technology Officer and led the company through the TechStars accelerator program. The company was later acquired by SRAM.',
    'Recently Raveen co-founded Lumi5 Labs with Victor, contributing his expertise to innovative projects. Prior to his current role, he was the CTO at Leadzen.ai. He has also co-founded LuminaryLane, an AI brand builder. His expertise spans Hardware, Gen AI and 0-to-1 product building. Raveen actively mentors startups through Techstars.',
    'COO & CMO',
    'Victor Chow is a seasoned entrepreneur and corporate leader with over 30 years of experience in investments, startups, telecommunications, cloud computing and blockchain technologies. He has held C-level positions across general management, strategic planning, and global operations in Asia Pacific, Europe, and North America.',
    "Victor's roles include CEO of Aristagora International, a multi-family office subsidiary of Aristagora Advisors based in Tokyo. He also served as Venture Partner for Fatfish Group. Previously, Victor was the Global COO for Cloud Computing at Huawei Technologies and the Global Business Director for SingTel-NCS Group. His expertise in fintech led him to become the Founding CEO of InspirAsia Fintech Accelerator.",
    "Let's Innovate Together",
    'Connect with us to explore how we can make your vision a reality. Join us in shaping the future.',
  ];
  for (const value of required) assert.ok(text.includes(value), value);

  for (const target of [
    'images/raveen.webp',
    'images/victor.webp',
    'https://www.linkedin.com/in/raveenbeemsingh/',
    'https://x.com/rbmsingh',
    'https://www.instagram.com/raveenb/',
    'https://raveenb.lumi5labs.com/',
    'https://www.linkedin.com/in/victorchowsingapore/',
    'https://victorc.lumi5labs.com/',
  ]) {
    assert.match(source, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /src=["']images\/raveen\.webp["'][^>]*width=["']600["'][^>]*height=["']600["'][^>]*loading=["']lazy["']/);
  assert.match(source, /src=["']images\/victor\.webp["'][^>]*width=["']600["'][^>]*height=["']600["'][^>]*loading=["']lazy["']/);
});

test('Contact preserves its details, map fallback and accessible form contract', () => {
  const source = read('contact.html');
  const document = parseHtml(source);
  const text = visibleBodyText(document);
  for (const value of [
    'Contact Us',
    'Here is how you can contact us for any questions or concerns.',
    'Get in Touch',
    '1 Fullerton Rd, #02-01 One Fullerton',
    'Singapore 049213',
    '+65-6599-1991',
    'business@lumi5labs.com',
    'Open in Google Maps',
    'Send Message',
  ]) {
    assert.ok(text.includes(value), value);
  }
  const form = findOne(document, (node) => (
    node.tagName === 'form'
    && node.attributes.id === 'contact-form'
    && hasClass(node, 'contact-form')
  ), 'Contact form');
  assert.equal(hasAttribute(form, 'novalidate'), true, 'Contact form uses custom validation');

  const fieldContracts = [
    {
      id: 'contact-name',
      tagName: 'input',
      label: 'Name',
      attributes: {
        name: 'name',
        type: 'text',
        maxlength: '100',
        placeholder: 'Your name',
        autocomplete: 'name',
        'aria-describedby': 'contact-name-error',
      },
      required: true,
    },
    {
      id: 'contact-email',
      tagName: 'input',
      label: 'Email',
      attributes: {
        name: 'email',
        type: 'email',
        maxlength: '255',
        placeholder: 'your@email.com',
        autocomplete: 'email',
        'aria-describedby': 'contact-email-error',
      },
      required: true,
    },
    {
      id: 'contact-message',
      tagName: 'textarea',
      label: 'Message (optional)',
      attributes: {
        name: 'message',
        maxlength: '5000',
        placeholder: 'How can we help you?',
        'aria-describedby': 'contact-message-error',
      },
      required: false,
    },
  ];
  for (const contract of fieldContracts) {
    const field = findOne(
      form,
      (node) => node.attributes.id === contract.id,
      contract.id,
    );
    assert.equal(field.tagName, contract.tagName, `${contract.id}: element type`);
    for (const [name, value] of Object.entries(contract.attributes)) {
      assert.equal(field.attributes[name], value, `${contract.id}: ${name}`);
    }
    assert.equal(hasAttribute(field, 'required'), contract.required, `${contract.id}: required state`);
    const label = findOne(
      form,
      (node) => node.tagName === 'label' && node.attributes.for === contract.id,
      `${contract.id}: associated label`,
    );
    assert.equal(textContent(label), contract.label, `${contract.id}: label text`);
    const error = findOne(
      form,
      (node) => node.attributes.id === `${contract.id}-error`,
      `${contract.id}: error message`,
    );
    assert.equal(error.tagName, 'p', `${contract.id}: error message element`);
  }

  const honeypot = findOne(
    form,
    (node) => node.tagName === 'div' && hasClass(node, 'contact-honeypot'),
    'Contact honeypot group',
  );
  assert.equal(
    honeypot.attributes['aria-hidden'],
    'true',
    'Contact honeypot group is hidden from assistive technology',
  );
  const honeypotLabel = findOne(
    honeypot,
    (node) => node.tagName === 'label' && node.attributes.for === 'contact-company-website',
    'Contact honeypot label',
  );
  assert.equal(textContent(honeypotLabel), 'Company website');
  const honeypotInput = findOne(
    honeypot,
    (node) => node.attributes.id === 'contact-company-website',
    'Contact honeypot input',
  );
  assert.equal(honeypotInput.tagName, 'input');
  assert.deepEqual({
    name: honeypotInput.attributes.name,
    type: honeypotInput.attributes.type,
    tabindex: honeypotInput.attributes.tabindex,
    autocomplete: honeypotInput.attributes.autocomplete,
    ariaHidden: honeypotInput.attributes['aria-hidden'],
  }, {
    name: 'company_website',
    type: 'text',
    tabindex: '-1',
    autocomplete: 'off',
    ariaHidden: 'true',
  });

  const submit = findOne(
    form,
    (node) => node.tagName === 'button' && node.attributes.id === 'contact-submit',
    'Contact submit button',
  );
  assert.equal(submit.attributes.type, 'submit');
  assert.equal(hasAttribute(submit, 'disabled'), true, 'Contact submit starts disabled');
  assert.equal(textContent(submit), 'Send Message');
  const status = findOne(
    form,
    (node) => node.attributes.id === 'contact-status',
    'Contact status region',
  );
  assert.equal(status.tagName, 'p');
  assert.deepEqual({
    role: status.attributes.role,
    ariaLive: status.attributes['aria-live'],
    tabindex: status.attributes.tabindex,
  }, {
    role: 'status',
    ariaLive: 'polite',
    tabindex: '-1',
  });

  const map = findOne(
    document,
    (node) => node.tagName === 'div' && hasClass(node, 'contact-map'),
    'Contact map',
  );
  const iframe = findOne(map, (node) => node.tagName === 'iframe', 'Contact map iframe');
  assert.deepEqual({
    title: iframe.attributes.title,
    src: decodeEntities(iframe.attributes.src),
    loading: iframe.attributes.loading,
    referrerpolicy: iframe.attributes.referrerpolicy,
  }, {
    title: 'Lumi5 Labs office location at One Fullerton, Singapore',
    src: 'https://www.google.com/maps?q=1%20Fullerton%20Rd%2C%20Singapore%20049213&output=embed',
    loading: 'lazy',
    referrerpolicy: 'no-referrer-when-downgrade',
  });
  assertExactLinks(map, [{
    label: 'Open in Google Maps',
    href: 'https://www.google.com/maps/search/?api=1&query=1%20Fullerton%20Rd%20Singapore%20049213',
    current: null,
  }], 'Contact map fallback');

  const scripts = findAll(document, (node) => (
    node.tagName === 'script' && hasAttribute(node, 'src')
  )).map((script) => script.attributes.src);
  assert.deepEqual(
    scripts,
    ['js/api.js?v=20260727.2', 'js/contact.js?v=20260727.1'],
    'Contact scripts load in API-then-form order',
  );
});

test('public content CSS is scoped, responsive, keyboard visible and motion safe', () => {
  const css = read('css/style.css');
  const publicCss = publicContentCss(css);
  const base = cssRuleBlocks(publicCss);
  assertPublicSelectorsScoped(publicCss);
  for (const selector of [
    'body.public-content-page',
    '.public-content-page .public-header',
    '.public-content-page .public-nav',
    '.public-content-page .public-menu',
    '.public-content-page .public-hero',
    '.public-content-page .story-orbit',
    '.public-content-page .about-journey',
    '.public-content-page .about-vision',
    '.public-content-page .vision-grid',
    '.public-content-page .leadership-grid',
    '.public-content-page .contact-layout',
    '.public-content-page .contact-map',
    '.public-content-page .contact-form',
    '.public-content-page .public-footer',
  ]) {
    cssRule(base, selector);
  }

  assert.match(
    cssProperty(base, '.public-content-page :focus-visible', 'outline'),
    /^\d+px solid #[\da-f]{6}$/i,
  );
  assert.equal(
    cssProperty(base, '.public-content-page .contact-honeypot', 'position'),
    'absolute',
  );
  assert.equal(
    cssProperty(base, '.public-content-page .contact-honeypot', 'clip'),
    'rect(0 0 0 0)',
  );
  assert.equal(
    cssProperty(base, '.public-content-page .about-vision', 'grid-template-columns'),
    'minmax(250px, 0.75fr) minmax(0, 1.25fr)',
  );
  assertPublicResponsiveContract(publicCss);

  const reducedMotion = cssMediaRules(publicCss, '(prefers-reduced-motion: reduce)');
  assert.equal(
    cssProperty(reducedMotion, '.public-content-page .story-orbit-node', 'animation'),
    'none',
  );

  for (const [selector, expected] of [
    ['.public-content-page .public-menu summary', '44px'],
    ['.public-content-page .public-menu nav a', '44px'],
    ['.public-content-page .contact-form input', '48px'],
    ['.public-content-page .contact-form textarea', '150px'],
    ['.public-content-page .contact-form .btn', '44px'],
  ]) {
    assert.equal(cssProperty(base, selector, 'min-height'), expected, selector);
  }
});

test('public CSS contracts reject selector leakage and responsive declarations moved to base', async (t) => {
  const publicCss = publicContentCss(read('css/style.css'));

  await t.test('unscoped selector leakage', () => {
    assert.throws(
      () => assertPublicSelectorsScoped(`${publicCss}\n.public-header { color: red; }\n`),
      /unscoped public selector.*\.public-header/,
    );
  });

  await t.test('compact navigation moved outside 979px', () => {
    const mutated = moveCssRuleOutsideMedia(
      publicCss,
      '(max-width: 979px)',
      '.public-content-page .public-nav',
    );
    assert.throws(
      () => assertPublicResponsiveContract(mutated),
      /missing CSS rule: \.public-content-page \.public-nav/,
    );
  });

  await t.test('leadership stacking moved outside 660px', () => {
    const mutated = moveCssRuleOutsideMedia(
      publicCss,
      '(max-width: 660px)',
      '.public-content-page .leadership-grid',
    );
    assert.throws(
      () => assertPublicResponsiveContract(mutated),
      /missing CSS rule: \.public-content-page \.leadership-grid/,
    );
  });
});

test('compact header anchors its popup to viewport-safe header insets at 320px', () => {
  const publicCss = publicContentCss(read('css/style.css'));
  const compact = cssMediaRules(publicCss, '(max-width: 979px)');
  const narrow = cssMediaRules(publicCss, '(max-width: 660px)');

  assert.equal(
    cssProperty(compact, '.public-content-page .public-header', 'grid-template-columns'),
    'minmax(0, 1fr) auto auto',
  );
  assert.equal(cssProperty(compact, '.public-content-page .public-menu', 'position'), 'static');
  assert.equal(cssProperty(compact, '.public-content-page .public-menu nav', 'left'), '24px');
  assert.equal(cssProperty(compact, '.public-content-page .public-menu nav', 'right'), '24px');
  assert.equal(cssProperty(compact, '.public-content-page .public-menu nav', 'width'), 'auto');

  assert.equal(cssProperty(narrow, '.public-content-page .public-header', 'gap'), '8px');
  assert.equal(cssProperty(narrow, '.public-content-page .public-header', 'padding'), '12px');
  assert.equal(cssProperty(narrow, '.public-content-page .public-brand', 'min-width'), '0');
  assert.equal(cssProperty(narrow, '.public-content-page .public-brand', 'width'), 'auto');
  assert.equal(cssProperty(narrow, '.public-content-page .public-brand-copy', 'min-width'), '0');
  assert.equal(
    cssProperty(narrow, '.public-content-page .public-brand-copy strong', 'text-overflow'),
    'ellipsis',
  );
  assert.equal(cssProperty(narrow, '.public-content-page .public-menu nav', 'left'), '12px');
  assert.equal(cssProperty(narrow, '.public-content-page .public-menu nav', 'right'), '12px');
});

test('contact labels and default control boundaries meet contrast requirements', () => {
  const css = read('css/style.css');
  const base = cssRuleBlocks(publicContentCss(css));
  const wash = cssHexVariable(css, '--public-wash');
  const label = cssResolvedColor(
    css,
    base,
    '.public-content-page .contact-form label',
  );
  const controlBorder = cssResolvedColor(
    css,
    base,
    '.public-content-page .contact-form input',
    'border',
  );

  assert.ok(contrastRatio(label, wash) >= 4.5, 'form label on form wash');
  assert.ok(contrastRatio(controlBorder, wash) >= 3, 'control border on form wash');
  assert.ok(contrastRatio(controlBorder, '#ffffff') >= 3, 'control border on input fill');
  assert.match(
    cssProperty(base, '.public-content-page .contact-form label', 'font-size'),
    /^(?:0\.\d+rem|1rem)$/,
  );
  assert.notEqual(
    cssProperty(base, '.public-content-page .contact-form label', 'line-height'),
    'normal',
  );
});

test('footer social heading and links use a coherent column layout', () => {
  const base = cssRuleBlocks(publicContentCss(read('css/style.css')));
  assert.equal(cssProperty(base, '.public-content-page .public-socials', 'display'), 'grid');
  assert.equal(
    cssProperty(base, '.public-content-page .public-socials', 'align-content'),
    'start',
  );
  assert.equal(cssProperty(base, '.public-content-page .leader-links', 'display'), 'flex');
});

test('public content eyebrow text meets AA contrast on light and dark surfaces', () => {
  const css = read('css/style.css');
  const base = cssRuleBlocks(publicContentCss(css));
  const lightEyebrow = cssResolvedColor(
    css,
    base,
    '.public-content-page .section-eyebrow',
  );
  const heroEyebrow = cssResolvedColor(
    css,
    base,
    '.public-content-page .public-hero .section-eyebrow',
  );
  const connectEyebrow = cssResolvedColor(
    css,
    base,
    '.public-content-page .about-connect .section-eyebrow',
  );

  assert.ok(contrastRatio(lightEyebrow, '#ffffff') >= 4.5, 'eyebrow on white');
  assert.ok(contrastRatio(lightEyebrow, '#eef1fb') >= 4.5, 'eyebrow on vision wash');
  assert.ok(contrastRatio(heroEyebrow, '#0b1024') >= 4.5, 'eyebrow on hero navy');
  assert.ok(contrastRatio(connectEyebrow, '#0b1024') >= 4.5, 'eyebrow on connect navy');
});

test('public content focus indicator has 3:1 contrast on light and dark surfaces', () => {
  const css = read('css/style.css');
  const base = cssRuleBlocks(publicContentCss(css));
  const outline = cssProperty(
    base,
    '.public-content-page :focus-visible',
    'outline',
  ).match(/^\d+px solid (#[\da-f]{6})$/i);
  assert.ok(outline, 'focus indicator uses a solid hex outline');
  assert.ok(contrastRatio(outline[1], '#ffffff') >= 3, 'focus outline on white');
  assert.ok(contrastRatio(outline[1], '#0b1024') >= 3, 'focus outline on navy');
});
