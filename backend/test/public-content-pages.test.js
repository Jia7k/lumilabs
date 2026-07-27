const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const visibleText = (source) => source
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const publicRoutes = [
  ['Home', 'index.html'],
  ['About', 'about.html'],
  ['Portfolio', 'https://www.lumi5labs.com/portfolio/'],
  ['Blog', 'https://www.lumi5labs.com/blog/'],
  ['FAQ', 'https://www.lumi5labs.com/faq/'],
  ['Contact', 'contact.html'],
  ['Sign in', 'signin.html'],
  ['Sign up', 'signup.html'],
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

test('both pages expose the exact public shell and one current-page marker', () => {
  for (const file of ['about.html', 'contact.html']) {
    const source = read(file);
    const text = visibleText(source);
    assert.equal((source.match(/<h1\b/gi) || []).length, 1, file);
    assert.match(source, /<details\b[^>]*class="[^"]*\bpublic-menu\b/);
    assert.match(source, /<summary\b[^>]*>[\s\S]*?Menu[\s\S]*?<\/summary>/);
    for (const [label, href] of publicRoutes) {
      assert.match(
        source,
        new RegExp(`href=["']${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>[\\s\\S]*?${label}`),
        `${file}: ${label}`,
      );
    }
    for (const fact of footerFacts) assert.ok(text.includes(fact), `${file}: ${fact}`);
    assert.equal((source.match(/aria-current=["']page["']/g) || []).length, 2, file);
    assert.doesNotMatch(source, /ai\.webp|artificial intelligence hero/i);
  }
  assert.match(read('about.html'), /href=["']about\.html["'][^>]*aria-current=["']page["']/);
  assert.match(read('contact.html'), /href=["']contact\.html["'][^>]*aria-current=["']page["']/);
});

test('About preserves the complete story, vision, leadership and connect copy', () => {
  const source = read('about.html');
  const text = visibleText(source);
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
  const text = visibleText(source);
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
  assert.match(source, /<form\b[^>]*id=["']contact-form["'][^>]*novalidate/);
  for (const id of [
    'contact-name',
    'contact-email',
    'contact-message',
    'contact-company-website',
    'contact-submit',
    'contact-status',
  ]) {
    assert.match(source, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(source, /id=["']contact-name["'][^>]*maxlength=["']100["'][^>]*aria-describedby=["']contact-name-error["']/);
  assert.match(source, /id=["']contact-email["'][^>]*maxlength=["']255["'][^>]*aria-describedby=["']contact-email-error["']/);
  assert.match(source, /id=["']contact-message["'][^>]*maxlength=["']5000["'][^>]*aria-describedby=["']contact-message-error["']/);
  assert.match(source, /id=["']contact-company-website["'][^>]*tabindex=["']-1["'][^>]*autocomplete=["']off["'][^>]*aria-hidden=["']true["']/);
  assert.match(source, /id=["']contact-status["'][^>]*role=["']status["'][^>]*aria-live=["']polite["'][^>]*tabindex=["']-1["']/);
  assert.match(source, /title=["']Lumi5 Labs office location at One Fullerton, Singapore["'][^>]*loading=["']lazy["']/);
  assert.match(source, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=1%20Fullerton%20Rd%20Singapore%20049213/);
  assert.match(
    source,
    /<script src=["']js\/api\.js\?v=20260727\.2["']><\/script>\s*<script src=["']js\/contact\.js\?v=20260727\.1["']><\/script>/,
  );
});
