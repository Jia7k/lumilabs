const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
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

test('visible copy excludes hidden and non-rendered subtrees', () => {
  const document = parseHtml(`
    <main>
      <p>Visible copy</p>
      <script>Script-only copy</script>
      <style>Style-only copy</style>
      <template>Template-only copy</template>
      <p hidden>Hidden-attribute copy</p>
      <p aria-hidden="true">ARIA-hidden copy</p>
    </main>
  `);

  assert.equal(visibleTextContent(document), 'Visible copy');
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
  const text = visibleTextContent(parseHtml(source));
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
  const text = visibleTextContent(document);
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
