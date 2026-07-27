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

const cssSelectors = (block) => splitSelectorArguments(block.prelude)
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
function cssColorChannels(value) {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    const expanded = hex[1].length <= 4
      ? [...hex[1]].map((channel) => channel.repeat(2)).join('')
      : hex[1];
    return {
      channels: expanded.slice(0, 6)
        .match(/[\da-f]{2}/gi)
        .map((channel) => parseInt(channel, 16)),
      alpha: expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1,
    };
  }
  if (value.toLowerCase() === 'transparent') {
    return { channels: [0, 0, 0], alpha: 0 };
  }

  const functional = value.match(/^rgba?\(([\s\S]*)\)$/i);
  assert.ok(functional, `unsupported CSS color: ${value}`);
  const body = functional[1].trim();
  const pieces = body.includes(',')
    ? body.split(',').map((piece) => piece.trim())
    : body.replace(/\s*\/\s*/, ' / ').split(/\s+/);
  const slash = pieces.indexOf('/');
  const channelPieces = slash === -1 ? pieces.slice(0, 3) : pieces.slice(0, slash);
  const alphaPiece = slash === -1 ? pieces[3] : pieces[slash + 1];
  assert.equal(channelPieces.length, 3, `invalid CSS color channels: ${value}`);

  const channels = channelPieces.map((piece) => {
    const channel = piece.endsWith('%')
      ? (Number(piece.slice(0, -1)) * 255) / 100
      : Number(piece);
    assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 255, value);
    return channel;
  });
  const alpha = alphaPiece === undefined
    ? 1
    : alphaPiece.endsWith('%')
      ? Number(alphaPiece.slice(0, -1)) / 100
      : Number(alphaPiece);
  assert.ok(Number.isFinite(alpha) && alpha >= 0 && alpha <= 1, value);
  return { channels, alpha };
}

const relativeLuminance = (channels) => {
  const normalized = channels.map((value) => value / 255);
  const [red, green, blue] = normalized.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};
const contrastRatio = (foreground, background) => {
  const foregroundColor = cssColorChannels(foreground);
  const backgroundColor = cssColorChannels(background);
  assert.equal(backgroundColor.alpha, 1, 'contrast background must be opaque');
  const compositedForeground = foregroundColor.channels.map((channel, index) => (
    (channel * foregroundColor.alpha)
    + (backgroundColor.channels[index] * (1 - foregroundColor.alpha))
  ));
  const [lighter, darker] = [
    relativeLuminance(compositedForeground),
    relativeLuminance(backgroundColor.channels),
  ].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
};

function cssStyleRules(source, media = [], rules = []) {
  for (const block of parseCssBlocks(source)) {
    if (block.prelude.startsWith('@keyframes ')) continue;
    if (block.prelude.startsWith('@media ')) {
      cssStyleRules(block.body, [...media, block.prelude.slice(7)], rules);
      continue;
    }
    if (block.prelude.startsWith('@')) continue;
    rules.push({ ...block, media, order: rules.length });
  }
  return rules;
}

function cssDeclarationList(block) {
  return block.body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration, order) => {
      const separator = declaration.indexOf(':');
      assert.notEqual(separator, -1, `invalid CSS declaration: ${declaration}`);
      const rawValue = normalizeCssWhitespace(declaration.slice(separator + 1));
      const important = /\s*!important$/i.test(rawValue);
      return {
        property: declaration.slice(0, separator).trim().toLowerCase(),
        value: rawValue.replace(/\s*!important$/i, ''),
        important,
        order,
      };
    });
}

function cssMediaApplies(conditions, viewportWidth) {
  return conditions.every((condition) => {
    const maxWidth = condition.match(/\(\s*max-width\s*:\s*(\d+)px\s*\)/i);
    if (maxWidth && viewportWidth > Number(maxWidth[1])) return false;
    const minWidth = condition.match(/\(\s*min-width\s*:\s*(\d+)px\s*\)/i);
    if (minWidth && viewportWidth < Number(minWidth[1])) return false;
    if (/prefers-reduced-motion/i.test(condition)) return false;
    return true;
  });
}

function splitCssSelector(selector) {
  const compounds = [];
  const combinators = [];
  let buffer = '';
  let quote = null;
  let squareDepth = 0;
  let roundDepth = 0;
  let pendingDescendant = false;

  const flush = () => {
    const value = buffer.trim();
    if (value) compounds.push(value);
    buffer = '';
  };

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      buffer += character;
      if (character === '\\') {
        index += 1;
        buffer += selector[index] || '';
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
      continue;
    }
    if (character === '[') squareDepth += 1;
    if (character === ']') squareDepth -= 1;
    if (character === '(') roundDepth += 1;
    if (character === ')') roundDepth -= 1;
    assert.ok(squareDepth >= 0 && roundDepth >= 0, `invalid selector: ${selector}`);

    if (squareDepth === 0 && roundDepth === 0 && /\s/.test(character)) {
      flush();
      pendingDescendant = compounds.length > combinators.length;
      continue;
    }
    if (squareDepth === 0 && roundDepth === 0 && ['>', '+', '~'].includes(character)) {
      flush();
      assert.equal(compounds.length, combinators.length + 1, `invalid selector: ${selector}`);
      combinators.push(character);
      pendingDescendant = false;
      continue;
    }
    if (pendingDescendant) {
      if (compounds.length === combinators.length + 1) combinators.push(' ');
      pendingDescendant = false;
    }
    buffer += character;
  }
  flush();
  assert.equal(squareDepth, 0, `unclosed attribute selector: ${selector}`);
  assert.equal(roundDepth, 0, `unclosed functional selector: ${selector}`);
  if (compounds.length !== combinators.length + 1) return null;
  return { compounds, combinators };
}

function matchingDelimiter(source, start, open, close) {
  let depth = 1;
  let quote = null;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === open) depth += 1;
    else if (character === close) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function splitSelectorArguments(source) {
  const argumentsList = [];
  let start = 0;
  let quote = null;
  let squareDepth = 0;
  let roundDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') squareDepth += 1;
    else if (character === ']') squareDepth -= 1;
    else if (character === '(') roundDepth += 1;
    else if (character === ')') roundDepth -= 1;
    else if (character === ',' && squareDepth === 0 && roundDepth === 0) {
      argumentsList.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  argumentsList.push(source.slice(start).trim());
  return argumentsList;
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const supportedSimplePseudos = new Set([
  'active',
  'checked',
  'disabled',
  'first-child',
  'first-of-type',
  'focus',
  'focus-visible',
  'hover',
  'invalid',
  'last-child',
  'last-of-type',
  'link',
  'only-child',
  'only-of-type',
  'open',
  'optional',
  'placeholder-shown',
  'required',
  'root',
  'valid',
  'visited',
]);

function parseCssCompound(source) {
  let cursor = 0;
  const tests = [];
  const specificity = [0, 0, 0];
  const tag = source.slice(cursor).match(/^[a-z][\w-]*/i)?.[0].toLowerCase();
  if (tag) {
    tests.push((candidate) => candidate.tag === tag);
    specificity[2] += 1;
    cursor += tag.length;
  } else if (source[cursor] === '*') {
    cursor += 1;
  }

  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '.' || character === '#') {
      const name = source.slice(cursor + 1).match(/^[\w-]+/)?.[0];
      if (!name) return null;
      if (character === '.') {
        tests.push((candidate) => candidate.classes.includes(name));
        specificity[1] += 1;
      } else {
        tests.push((candidate) => candidate.id === name);
        specificity[0] += 1;
      }
      cursor += name.length + 1;
      continue;
    }
    if (character === '[') {
      const close = matchingDelimiter(source, cursor, '[', ']');
      if (close === -1) return null;
      const attribute = source.slice(cursor + 1, close).trim().match(
        /^([\w:-]+)(?:\s*(=|~=|\|=|\^=|\$=|\*=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?(?:\s+([is]))?$/i,
      );
      if (!attribute) return null;
      const [, name, operator, doubleQuoted, singleQuoted, bare, flag] = attribute;
      const normalizedName = name.toLowerCase();
      const expected = doubleQuoted ?? singleQuoted ?? bare;
      tests.push((candidate) => {
        const actual = candidate.attributes[normalizedName];
        if (actual === undefined) return false;
        if (!operator) return true;
        const comparableActual = flag?.toLowerCase() === 'i' ? actual.toLowerCase() : actual;
        const comparableExpected = flag?.toLowerCase() === 'i'
          ? expected.toLowerCase()
          : expected;
        if (operator === '=') return comparableActual === comparableExpected;
        if (operator === '~=') {
          return comparableActual.split(/\s+/).includes(comparableExpected);
        }
        if (operator === '|=') {
          return comparableActual === comparableExpected
            || comparableActual.startsWith(`${comparableExpected}-`);
        }
        if (operator === '^=') return comparableActual.startsWith(comparableExpected);
        if (operator === '$=') return comparableActual.endsWith(comparableExpected);
        return comparableActual.includes(comparableExpected);
      });
      specificity[1] += 1;
      cursor = close + 1;
      continue;
    }
    if (character === ':') {
      if (source[cursor + 1] === ':') return null;
      const name = source.slice(cursor + 1).match(/^[\w-]+/)?.[0]?.toLowerCase();
      if (!name) return null;
      cursor += name.length + 1;
      if (source[cursor] !== '(') {
        if (!supportedSimplePseudos.has(name)) return null;
        tests.push((candidate) => candidate.pseudos.includes(name));
        specificity[1] += 1;
        continue;
      }

      const close = matchingDelimiter(source, cursor, '(', ')');
      if (close === -1 || !['is', 'not', 'where'].includes(name)) return null;
      const alternatives = splitSelectorArguments(source.slice(cursor + 1, close))
        .map(parseCssCompound);
      if (alternatives.some((alternative) => alternative === null)) return null;
      if (name === 'not') {
        tests.push((candidate) => alternatives.every((alternative) => !alternative.matches(candidate)));
      } else {
        tests.push((candidate) => alternatives.some((alternative) => alternative.matches(candidate)));
      }
      if (name !== 'where') {
        const maximum = alternatives
          .map((alternative) => alternative.specificity)
          .sort((left, right) => compareSpecificity(right, left))[0];
        maximum.forEach((value, index) => {
          specificity[index] += value;
        });
      }
      cursor = close + 1;
      continue;
    }
    return null;
  }

  return {
    matches: (candidate) => tests.every((testMatch) => testMatch(candidate)),
    specificity,
  };
}

function parseCssSelector(selector) {
  const split = splitCssSelector(selector);
  if (!split || split.combinators.some((combinator) => ['+', '~'].includes(combinator))) {
    return null;
  }
  const compounds = split.compounds.map(parseCssCompound);
  if (compounds.some((compound) => compound === null)) return null;
  return {
    compounds,
    combinators: split.combinators,
    specificity: compounds.reduce(
      (total, compound) => total.map((value, index) => (
        value + compound.specificity[index]
      )),
      [0, 0, 0],
    ),
  };
}

function selectorMayTargetLeaf(selector, ancestry) {
  const split = splitCssSelector(selector);
  if (!split) return true;
  const source = split.compounds.at(-1);
  const leaf = ancestry.at(-1);
  const tag = source.match(/^[a-z][\w-]*/i)?.[0].toLowerCase();
  const id = source.match(/#([\w-]+)/)?.[1];
  const classes = [...source.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  if (tag && tag !== leaf.tag) return false;
  if (id && id !== leaf.id) return false;
  if (classes.some((className) => !leaf.classes.includes(className))) return false;
  return true;
}

function cssSelectorMatches(selector, ancestry) {
  const parsed = parseCssSelector(selector);
  if (!parsed) return null;
  const { compounds, combinators } = parsed;
  let ancestryIndex = ancestry.length - 1;
  if (!compounds.at(-1).matches(ancestry[ancestryIndex])) return false;

  for (let index = compounds.length - 2; index >= 0; index -= 1) {
    if (combinators[index] === '>') {
      ancestryIndex -= 1;
      if (
        ancestryIndex < 0
        || !compounds[index].matches(ancestry[ancestryIndex])
      ) return false;
    } else {
      ancestryIndex -= 1;
      while (
        ancestryIndex >= 0
        && !compounds[index].matches(ancestry[ancestryIndex])
      ) {
        ancestryIndex -= 1;
      }
      if (ancestryIndex < 0) return false;
    }
  }
  return true;
}

function compareCssCandidates(left, right) {
  if (left.important !== right.important) return Number(left.important) - Number(right.important);
  for (let index = 0; index < left.specificity.length; index += 1) {
    if (left.specificity[index] !== right.specificity[index]) {
      return left.specificity[index] - right.specificity[index];
    }
  }
  if (left.ruleOrder !== right.ruleOrder) return left.ruleOrder - right.ruleOrder;
  return left.declarationOrder - right.declarationOrder;
}

function cssCascadeCandidates(
  css,
  ancestry,
  viewportWidth,
  auditedProperties,
  styleRules = cssStyleRules(css),
) {
  const candidates = [];
  for (const rule of styleRules) {
    if (!cssMediaApplies(rule.media, viewportWidth)) continue;
    rule.declarations ||= cssDeclarationList(rule);
    const declarations = rule.declarations
      .filter((declaration) => auditedProperties.includes(declaration.property));
    if (declarations.length === 0) continue;
    for (const selector of cssSelectors(rule)) {
      const matches = cssSelectorMatches(selector, ancestry);
      if (matches === null) {
        assert.ok(
          !selectorMayTargetLeaf(selector, ancestry),
          `unsupported selector can affect audited CSS: ${selector}`,
        );
        continue;
      }
      if (!matches) continue;
      const specificity = parseCssSelector(selector).specificity;
      for (const declaration of declarations) {
        candidates.push({
          ...declaration,
          selector,
          specificity,
          ruleOrder: rule.order,
          declarationOrder: declaration.order,
        });
      }
    }
  }
  return candidates;
}

function winningCssCandidate(candidates, label) {
  assert.notEqual(candidates.length, 0, `missing effective CSS declaration: ${label}`);
  return candidates.reduce((winner, candidate) => (
    compareCssCandidates(candidate, winner) > 0 ? candidate : winner
  ));
}

function effectiveCssProperty(
  css,
  ancestry,
  property,
  viewportWidth = 1024,
  styleRules = cssStyleRules(css),
) {
  return winningCssCandidate(
    cssCascadeCandidates(css, ancestry, viewportWidth, [property], styleRules),
    property,
  ).value;
}

function effectiveCssPropertyOrInitial(
  css,
  ancestry,
  property,
  initialValue,
  viewportWidth = 1024,
  styleRules = cssStyleRules(css),
) {
  const candidates = cssCascadeCandidates(
    css,
    ancestry,
    viewportWidth,
    [property],
    styleRules,
  );
  return candidates.length === 0
    ? initialValue
    : winningCssCandidate(candidates, property).value;
}

function effectiveCssCustomProperty(
  css,
  ancestry,
  property,
  viewportWidth,
  styleRules,
) {
  assert.match(property, /^--[\w-]+$/, `invalid CSS custom property: ${property}`);
  for (let index = ancestry.length - 1; index >= 0; index -= 1) {
    const declaringAncestry = ancestry.slice(0, index + 1);
    const candidates = cssCascadeCandidates(
      css,
      declaringAncestry,
      viewportWidth,
      [property],
      styleRules,
    );
    if (candidates.length > 0) {
      return {
        ancestry: declaringAncestry,
        value: winningCssCandidate(candidates, property).value,
      };
    }
  }
  return null;
}

function firstCssVarFunction(value) {
  const match = value.match(/\bvar\s*\(/i);
  if (!match) return null;
  const open = value.indexOf('(', match.index);
  const close = matchingDelimiter(value, open, '(', ')');
  assert.notEqual(close, -1, `unclosed CSS var(): ${value}`);
  const body = value.slice(open + 1, close);
  let quote = null;
  let depth = 0;
  let separator = -1;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      separator = index;
      break;
    }
    assert.ok(depth >= 0, `invalid CSS var(): ${value}`);
  }
  const property = body.slice(0, separator === -1 ? body.length : separator).trim();
  assert.match(property, /^--[\w-]+$/, `unsupported CSS var() name: ${property}`);
  return {
    end: close + 1,
    fallback: separator === -1 ? null : body.slice(separator + 1).trim(),
    property,
    start: match.index,
  };
}

function resolveCssVariables(
  css,
  ancestry,
  value,
  label,
  viewportWidth,
  styleRules,
  resolutionStack = [],
) {
  assert.ok(
    resolutionStack.length < 64,
    `${label}: CSS custom property resolution exceeded its bound`,
  );
  let resolved = value;
  for (let replacements = 0; replacements < 64; replacements += 1) {
    const variable = firstCssVarFunction(resolved);
    if (!variable) return resolved;
    const declaration = effectiveCssCustomProperty(
      css,
      ancestry,
      variable.property,
      viewportWidth,
      styleRules,
    );
    let replacement;
    if (!declaration) {
      assert.notEqual(
        variable.fallback,
        null,
        `${label}: unresolved CSS custom property ${variable.property}`,
      );
      replacement = resolveCssVariables(
        css,
        ancestry,
        variable.fallback,
        label,
        viewportWidth,
        styleRules,
        resolutionStack,
      );
    } else {
      const key = `${declaration.ancestry.length - 1}:${variable.property}`;
      assert.ok(
        !resolutionStack.includes(key),
        `${label}: cyclic CSS custom property ${variable.property}`,
      );
      replacement = resolveCssVariables(
        css,
        declaration.ancestry,
        declaration.value,
        label,
        viewportWidth,
        styleRules,
        [...resolutionStack, key],
      );
    }
    resolved = (
      resolved.slice(0, variable.start)
      + replacement
      + resolved.slice(variable.end)
    );
    assert.ok(
      resolved.length <= 10000,
      `${label}: resolved CSS value exceeds its size bound`,
    );
  }
  assert.fail(`${label}: CSS custom property replacement exceeded its bound`);
}

function cssResolvedColorAt(
  css,
  ancestry,
  value,
  label,
  viewportWidth,
  styleRules,
) {
  const resolved = resolveCssVariables(
    css,
    ancestry,
    value,
    label,
    viewportWidth,
    styleRules,
  );
  assert.doesNotMatch(resolved, /\bvar\s*\(/i, `${label}: unresolved CSS var()`);
  return cssColorFromValue(css, resolved, label);
}

function cssColorFromValue(css, value, label) {
  const match = value.match(
    /(#[\da-f]{8}(?![\da-f])|#[\da-f]{6}(?![\da-f])|#[\da-f]{4}(?![\da-f])|#[\da-f]{3}(?![\da-f])|var\((--[\w-]+)\)|rgba?\([^)]*\)|transparent)/i,
  );
  assert.ok(match, `missing color value for ${label}`);
  return match[2] ? cssHexVariable(css, match[2]) : match[1];
}

const borderStyles = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
  'none',
  'hidden',
]);

function parseBorderShorthand(value) {
  const tokens = value.split(/\s+/);
  const color = value.match(
    /(?:#[\da-f]{8}(?![\da-f])|#[\da-f]{6}(?![\da-f])|#[\da-f]{4}(?![\da-f])|#[\da-f]{3}(?![\da-f])|var\(--[\w-]+\)|rgba?\([^)]*\)|\btransparent\b)/i,
  )?.[0];
  return {
    width: tokens.find((token) => /^(?:\d*\.)?\d+(?:px|rem|em)?$/i.test(token))
      || 'medium',
    style: tokens.find((token) => borderStyles.has(token.toLowerCase()))
      || 'none',
    color: color || 'currentcolor',
  };
}

function effectiveControlBorder(css, ancestry, styleRules = cssStyleRules(css)) {
  const candidates = cssCascadeCandidates(
    css,
    ancestry,
    1024,
    ['border', 'border-width', 'border-style', 'border-color'],
    styleRules,
  );
  const componentCandidates = (component) => candidates.flatMap((candidate) => {
    if (candidate.property === `border-${component}`) return [candidate];
    if (candidate.property !== 'border') return [];
    const value = parseBorderShorthand(candidate.value)[component];
    return value ? [{ ...candidate, value }] : [];
  });
  return {
    width: winningCssCandidate(componentCandidates('width'), 'border width').value,
    style: winningCssCandidate(componentCandidates('style'), 'border style').value,
    color: winningCssCandidate(componentCandidates('color'), 'border color').value,
  };
}

const element = (
  tag,
  classes = [],
  id = null,
  attributes = {},
  pseudos = [],
) => ({
  tag,
  classes,
  id,
  attributes,
  pseudos,
});
const publicNavAncestry = [
  element('body', ['public-content-page', 'contact-page']),
  element('header', ['public-header']),
  element(
    'nav',
    ['public-nav'],
    null,
    { 'aria-label': 'Primary navigation' },
    ['first-of-type', 'last-of-type', 'only-of-type'],
  ),
];
const publicMenuAncestry = [
  element('body', ['public-content-page', 'contact-page']),
  element('header', ['public-header']),
  element('details', ['public-menu']),
];

function elementFromHtmlNode(node, pseudos = [], attributeOverrides = {}) {
  const attributes = { ...node.attributes };
  for (const [name, value] of Object.entries(attributeOverrides)) {
    if (value === undefined) delete attributes[name];
    else attributes[name] = value;
  }
  return element(
    node.tagName,
    (node.attributes.class || '').split(/\s+/).filter(Boolean),
    node.attributes.id || null,
    attributes,
    pseudos,
  );
}

function contactControlStateVariants(control) {
  const required = hasAttribute(control, 'required');
  const staticPseudos = [
    'first-of-type',
    'last-of-type',
    'only-of-type',
    required ? 'required' : 'optional',
  ];
  const placeholderShown = hasAttribute(control, 'placeholder')
    ? ['placeholder-shown']
    : [];
  const valueStates = required
    ? [
      ['invalid', ...placeholderShown],
      ['invalid'],
      ['valid'],
    ]
    : [
      ['valid', ...placeholderShown],
      ['valid'],
      ['invalid'],
    ];
  const stateGroups = [
    [[], ['focus'], ['focus', 'focus-visible']],
    [[], ['hover']],
    [[], ['active']],
    valueStates,
  ];
  let variants = [[]];
  for (const group of stateGroups) {
    variants = variants.flatMap((variant) => (
      group.map((states) => [...variant, ...states])
    ));
  }
  return variants.flatMap((states) => {
    const pseudos = [...staticPseudos, ...states];
    const ariaInvalidValues = states.includes('invalid')
      ? [undefined, 'true']
      // Client length validation can set aria-invalid while native :valid remains true.
      : [undefined, 'false', 'true'];
    return ariaInvalidValues.map((ariaInvalid) => ({
      attributeOverrides: { 'aria-invalid': ariaInvalid },
      pseudos,
    }));
  });
}

function contactFormFieldTargets() {
  const document = parseHtml(read('contact.html'));
  const body = findOne(document, (node) => node.tagName === 'body', 'Contact body');
  const main = findOne(body, (node) => node.tagName === 'main', 'Contact main');
  const section = findOne(main, (node) => (
    node.tagName === 'section' && hasClass(node, 'contact-layout')
  ), 'Contact layout');
  const form = findOne(section, (node) => (
    node.tagName === 'form' && hasClass(node, 'contact-form')
  ), 'Contact form');
  const baseAncestry = [
    elementFromHtmlNode(body),
    elementFromHtmlNode(main),
    elementFromHtmlNode(section),
    elementFromHtmlNode(form),
  ];
  const groups = findAll(form, (node) => (
    node.tagName === 'div' && hasClass(node, 'form-group')
  ));

  return groups.map((group) => {
    const label = findOne(group, (node) => node.tagName === 'label', 'Contact label');
    const control = findOne(
      group,
      (node) => ['input', 'textarea'].includes(node.tagName),
      'Contact control',
    );
    const error = findOne(
      group,
      (node) => node.tagName === 'p' && hasClass(node, 'form-error-text'),
      'Contact field error',
    );
    const groupAncestry = [...baseAncestry, elementFromHtmlNode(group)];
    const labelStates = [
      ['first-child', 'first-of-type', 'last-of-type', 'only-of-type'],
      ['first-child', 'first-of-type', 'last-of-type', 'only-of-type', 'hover'],
      ['first-child', 'first-of-type', 'last-of-type', 'only-of-type', 'active'],
    ];
    return {
      controlId: control.attributes.id,
      controlAncestries: contactControlStateVariants(control).map((state) => (
        [
          ...groupAncestry,
          elementFromHtmlNode(control, state.pseudos, state.attributeOverrides),
        ]
      )),
      labelAncestries: labelStates.map((pseudos) => (
        [...groupAncestry, elementFromHtmlNode(label, pseudos)]
      )),
      errorAncestry: [...groupAncestry, elementFromHtmlNode(error)],
    };
  });
}

function messageStateAncestry(file, id, stateClass = null) {
  const path = findElementPath(
    parseHtml(read(file)),
    (node) => node.attributes.id === id,
  );
  assert.ok(path, `${file}: ${id} ancestry`);
  const ancestry = path.map((node) => elementFromHtmlNode(node));
  const root = ancestry.find((candidate) => candidate.tag === 'html');
  assert.ok(root, `${file}: root element`);
  root.pseudos.push('root');
  const message = ancestry.at(-1);
  assert.ok(message.classes.includes('form-message'), `${id}: form-message class`);
  message.classes = message.classes
    .filter((className) => !['success', 'error'].includes(className));
  if (stateClass) message.classes.push(stateClass);
  message.attributes.class = message.classes.join(' ');
  return ancestry;
}

function publicClassNames(publicCss) {
  const sharedClasses = new Set([
    'btn',
    'error',
    'form-error-text',
    'form-message',
    'success',
  ]);
  const names = new Set();
  for (const rule of cssStyleRules(publicCss)) {
    for (const selector of cssSelectors(rule)) {
      for (const match of selector.matchAll(/\.([\w-]+)/g)) {
        if (!sharedClasses.has(match[1])) names.add(match[1]);
      }
    }
  }
  return names;
}

function assertPublicSelectorsScopedAcrossStylesheet(css) {
  const publicClasses = publicClassNames(publicContentCss(css));
  for (const rule of cssStyleRules(css)) {
    for (const selector of cssSelectors(rule)) {
      const targetsPublicClass = [...selector.matchAll(/\.([\w-]+)/g)]
        .some((match) => publicClasses.has(match[1]));
      if (!targetsPublicClass) continue;
      assert.match(
        selector,
        /\.public-content-page(?![\w-])/,
        `unscoped public selector in full stylesheet: ${selector}`,
      );
    }
  }
}

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

function assertPublicStylesheetContract(css) {
  const publicCss = publicContentCss(css);
  assertPublicSelectorsScoped(publicCss);
  assertPublicSelectorsScopedAcrossStylesheet(css);
  assertPublicResponsiveContract(publicCss);
  assert.equal(
    effectiveCssProperty(css, publicNavAncestry, 'display', 979),
    'none',
    '979px hides full public nav after the full cascade',
  );
  assert.equal(
    effectiveCssProperty(css, publicMenuAncestry, 'display', 979),
    'block',
    '979px shows compact public menu after the full cascade',
  );
}

function assertContactContrastContract(css) {
  const wash = cssHexVariable(css, '--public-wash');
  const styleRules = cssStyleRules(css);
  const fields = contactFormFieldTargets();

  for (const field of fields) {
    for (const labelAncestry of field.labelAncestries) {
      const label = cssColorFromValue(
        css,
        effectiveCssProperty(css, labelAncestry, 'color', 1024, styleRules),
        `effective label color for ${field.controlId}`,
      );
      assert.ok(contrastRatio(label, wash) >= 4.5, 'form label on form wash');
      assert.match(
        effectiveCssProperty(css, labelAncestry, 'font-size', 1024, styleRules),
        /^(?:0\.\d+rem|1rem)$/,
      );
      assert.notEqual(
        effectiveCssProperty(css, labelAncestry, 'line-height', 1024, styleRules),
        'normal',
      );
    }

    for (const controlAncestry of field.controlAncestries) {
      const border = effectiveControlBorder(css, controlAncestry, styleRules);
      const width = border.width.match(/^((?:\d*\.)?\d+)(?:px|rem|em)?$/i);
      assert.ok(
        width && Number(width[1]) > 0,
        `${field.controlId} has a visible control border with non-zero width`,
      );
      assert.ok(
        borderStyles.has(border.style) && !['none', 'hidden'].includes(border.style),
        `${field.controlId} has a visible control border style`,
      );
      const borderColor = cssColorFromValue(
        css,
        border.color,
        `${field.controlId} border`,
      );
      assert.ok(contrastRatio(borderColor, wash) >= 3, 'control border on form wash');
      assert.ok(contrastRatio(borderColor, '#ffffff') >= 3, 'control border on input fill');
    }
  }
}

function assertContactStatusContract(css) {
  const styleRules = cssStyleRules(css);
  const base = messageStateAncestry('contact.html', 'contact-status');
  assert.equal(base.at(-1).attributes.tabindex, '-1', 'Contact status is programmatically focusable');
  assert.equal(
    effectiveCssProperty(css, base, 'display', 1024, styleRules),
    'none',
    'empty Contact status remains intentionally hidden',
  );

  for (const state of ['success', 'error']) {
    const ancestry = messageStateAncestry('contact.html', 'contact-status', state);
    assert.equal(
      ancestry.at(-1).attributes.tabindex,
      '-1',
      `${state} Contact status is programmatically focusable`,
    );
    assert.notEqual(
      effectiveCssProperty(css, ancestry, 'display', 1024, styleRules),
      'none',
      `${state} Contact status is rendered`,
    );
    const visibility = effectiveCssPropertyOrInitial(
      css,
      ancestry,
      'visibility',
      'visible',
      1024,
      styleRules,
    );
    assert.ok(
      !['hidden', 'collapse'].includes(visibility),
      `${state} Contact status is visible`,
    );
    const opacity = effectiveCssPropertyOrInitial(
      css,
      ancestry,
      'opacity',
      '1',
      1024,
      styleRules,
    );
    assert.ok(
      Number.parseFloat(opacity) > 0,
      `${state} Contact status is opaque`,
    );
    assert.match(
      effectiveCssProperty(css, ancestry, 'min-height', 1024, styleRules),
      /^(?:\d*\.)?[1-9]\d*(?:px|rem|em)$/,
      `${state} Contact status has a non-zero rendered height`,
    );

    const foreground = cssResolvedColorAt(
      css,
      ancestry,
      effectiveCssProperty(css, ancestry, 'color', 1024, styleRules),
      `${state} Contact status text`,
      1024,
      styleRules,
    );
    const background = cssResolvedColorAt(
      css,
      ancestry,
      effectiveCssProperty(css, ancestry, 'background', 1024, styleRules),
      `${state} Contact status background`,
      1024,
      styleRules,
    );
    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `${state} Contact status text meets AA contrast`,
    );
  }

  for (const state of [null, 'success', 'error']) {
    const ancestry = messageStateAncestry('signin.html', 'signin-message', state);
    assert.equal(
      effectiveCssProperty(css, ancestry, 'display', 1024, styleRules),
      'none',
      `generic Sign-in ${state || 'base'} message behavior is unchanged`,
    );
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

function findElementPath(node, predicate, ancestors = []) {
  for (const child of node.children) {
    if (child.tagName === '#text') continue;
    const path = [...ancestors, child];
    if (predicate(child)) return path;
    const nested = findElementPath(child, predicate, path);
    if (nested) return nested;
  }
  return null;
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
        'data-max-code-points': '100',
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
        'data-max-code-points': '255',
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
        'data-max-code-points': '5000',
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
    assert.equal(
      hasAttribute(field, 'maxlength'),
      false,
      `${contract.id}: native maxlength must not truncate astral code points`,
    );
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
    ['js/api.js?v=20260728.2', 'js/contact.js?v=20260728.2'],
    'Contact scripts load in API-then-form order',
  );
});

test('public content CSS is scoped, responsive, keyboard visible and motion safe', () => {
  const css = read('css/style.css');
  const publicCss = publicContentCss(css);
  const base = cssRuleBlocks(publicCss);
  assertPublicStylesheetContract(css);
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
  const css = read('css/style.css');
  const publicCss = publicContentCss(css);

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

  await t.test('unscoped public selector after the admin marker', () => {
    assert.throws(
      () => assertPublicStylesheetContract(`${css}\n.public-header { color: red; }\n`),
      /unscoped public selector.*\.public-header/,
    );
  });

  await t.test('later, more-specific override reveals full nav below 980px', () => {
    const mutated = `${css}
@media (max-width: 979px) {
  body.public-content-page .public-header .public-nav { display: flex; }
}
`;
    assert.throws(
      () => assertPublicStylesheetContract(mutated),
      /979px hides full public nav/,
    );
  });

  await t.test('important child-combinator override reveals full nav below 980px', () => {
    const mutated = `${css}
@media (max-width:979px) {
  body.public-content-page .public-header > .public-nav { display:flex!important; }
}
`;
    assert.throws(
      () => assertPublicStylesheetContract(mutated),
      /979px hides full public nav/,
    );
  });

  await t.test('matching attribute selector reveals full nav below 980px', () => {
    const mutated = `${css}
@media (max-width: 979px) {
  body.public-content-page .public-header > nav.public-nav[aria-label="Primary navigation"] {
    display: flex !important;
  }
}
`;
    assert.throws(
      () => assertPublicStylesheetContract(mutated),
      /979px hides full public nav/,
    );
  });

  await t.test('matching functional pseudo selector reveals full nav below 980px', () => {
    const mutated = `${css}
@media (max-width: 979px) {
  body.public-content-page .public-header > .public-nav:not([hidden]) {
    display: flex !important;
  }
}
`;
    assert.throws(
      () => assertPublicStylesheetContract(mutated),
      /979px hides full public nav/,
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
  assertContactContrastContract(css);
});

test('runtime aria-invalid states keep contrast-safe control boundaries', () => {
  const css = read('css/style.css');
  const wash = cssHexVariable(css, '--public-wash');
  const styleRules = cssStyleRules(css);
  const coveredControls = new Set();

  for (const field of contactFormFieldTargets()) {
    for (const ancestry of field.controlAncestries) {
      if (ancestry.at(-1).attributes['aria-invalid'] !== 'true') continue;
      coveredControls.add(field.controlId);
      const border = effectiveControlBorder(css, ancestry, styleRules);
      const color = cssColorFromValue(css, border.color, `${field.controlId} invalid border`);
      assert.ok(contrastRatio(color, wash) >= 3, `${field.controlId} invalid border on wash`);
      assert.ok(
        contrastRatio(color, '#ffffff') >= 3,
        `${field.controlId} invalid border on fill`,
      );
    }
  }

  assert.deepEqual(
    [...coveredControls].sort(),
    ['contact-email', 'contact-message', 'contact-name'],
  );
});

test('contact field errors remain visible after the full CSS cascade', () => {
  const css = read('css/style.css');

  for (const field of contactFormFieldTargets()) {
    assert.equal(
      effectiveCssProperty(css, field.errorAncestry, 'display'),
      'block',
      `${field.controlId}: error text display`,
    );
  }
});

test('contact status feedback remains visible and focusable after the full CSS cascade', () => {
  assertContactStatusContract(read('css/style.css'));
});

test('contact status contract rejects effective full-cascade overrides', async (t) => {
  const css = read('css/style.css');

  for (const state of ['success', 'error']) {
    await t.test(`${state} class attribute selector hides the status`, () => {
      const mutated = `${css}
#contact-status[class~="${state}"] { display: none !important; }
`;
      assert.throws(
        () => assertContactStatusContract(mutated),
        new RegExp(`${state} Contact status is rendered`),
      );
    });
  }

  for (const [state, variable, lowContrastBackground] of [
    ['success', '--green-bg', '#286745'],
    ['error', '--red-bg', '#9d2118'],
  ]) {
    await t.test(`${state} page-scoped background variable loses AA contrast`, () => {
      const mutated = `${css}
.public-content-page .contact-form {
  ${variable}: ${lowContrastBackground};
}
`;
      assert.throws(
        () => assertContactStatusContract(mutated),
        new RegExp(`${state} Contact status text meets AA contrast`),
      );
    });
  }

  await t.test('custom-property fallback participates in contrast resolution', () => {
    const mutated = `${css}
.public-content-page .contact-form {
  --green-bg: var(--missing-contact-bg, #286745);
}
`;
    assert.throws(
      () => assertContactStatusContract(mutated),
      /success Contact status text meets AA contrast/,
    );
  });

  await t.test('cyclic custom properties fail closed', () => {
    const mutated = `${css}
.public-content-page .contact-form {
  --green-bg: var(--contact-feedback-cycle);
  --contact-feedback-cycle: var(--green-bg);
}
`;
    assert.throws(
      () => assertContactStatusContract(mutated),
      /cyclic CSS custom property/,
    );
  });
});

test('contact contrast contract rejects effective overrides and invisible borders', async (t) => {
  const css = read('css/style.css');

  await t.test('later, more-specific label color override', () => {
    const mutated = `${css}
body.public-content-page .contact-form .form-group label { color: #9ca3af; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /form label on form wash/,
    );
  });

  await t.test('important generic label color override', () => {
    const mutated = `${css}
.form-group label { color: #9ca3af !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /form label on form wash/,
    );
  });

  await t.test('important generic border color override', () => {
    const mutated = `${css}
.form-group input { border: 1px solid #cdd3df !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('later, more-specific border-color override', () => {
    const mutated = `${css}
body.public-content-page .contact-form .form-group input { border-color: #cdd3df; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('important RGBA border override', () => {
    const mutated = `${css}
.form-group input { border: 1px solid rgba(205,211,223,1) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('matching input type attribute override', () => {
    const mutated = `${css}
input[type="text"] { border: 1px solid rgba(205,211,223,1) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('matching input name attribute override', () => {
    const mutated = `${css}
input[name="name"] { border: 1px solid rgba(205,211,223,1) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('matching placeholder attribute override', () => {
    const mutated = `${css}
input[placeholder="Your name"] { border: 1px solid rgba(205,211,223,1) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('reachable invalid state override', () => {
    const mutated = `${css}
input:invalid { border: 1px solid rgba(205,211,223,1) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('low-contrast existing aria-invalid border', () => {
    const mutated = css.replace(
      '.public-content-page .contact-form [aria-invalid="true"] {\n  border-color: #b42318;\n}',
      '.public-content-page .contact-form [aria-invalid="true"] {\n  border-color: #cdd3df;\n}',
    );
    assert.notEqual(mutated, css, 'existing aria-invalid border mutation applied');
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('important runtime aria-invalid border override', () => {
    const mutated = `${css}
input[aria-invalid="true"] {
  border: 1px solid rgba(205,211,223,1) !important;
}
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('reachable placeholder-shown state override', () => {
    const mutated = `${css}
input:placeholder-shown { border: 1px solid rgba(205,211,223,1) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('reachable focus state override', () => {
    const mutated = `${css}
input:focus { border: 1px solid rgba(205,211,223,1) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('fully transparent border override', () => {
    const mutated = `${css}
.form-group input { border: 1px solid rgba(123,135,158,0) !important; }
`;
    assert.throws(
      () => assertContactContrastContract(mutated),
      /control border on form wash/,
    );
  });

  await t.test('zero-width none border with a contrast-safe color', () => {
    const mutated = css.replace(
      'border: 1px solid #7b879e;',
      'border: 0 none #7b879e;',
    );
    assert.notEqual(mutated, css, 'border mutation applied');
    assert.throws(
      () => assertContactContrastContract(mutated),
      /visible control border/,
    );
  });
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
