'use strict';

// Run after building index.html. A packaged/local copy can be checked with
// BABELIAN_APP_FILE; PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE let the test use
// an already-installed Playwright/Chrome without downloading a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const palettes = {
  babelian: {
    cycle: 'c4',
    '--bg': '#faf7ed', '--panel': '#fffef9', '--line': '#e8dfc4',
    '--accent': '#a0843d', '--accent-strong': '#765d24',
    '--accent-soft': '#f1e8ca', '--gold': '#8e732f'
  },
  siren: {
    cycle: 'c5',
    '--bg': '#eef3f7', '--panel': '#fbfdff', '--line': '#d3e0e8',
    '--accent': '#06243d', '--accent-strong': '#041b2e',
    '--accent-soft': '#e0eaf1', '--gold': '#95702b'
  }
};
const entries = [
  {id: 'language-open-babelian', language: 'babelian', mode: 'generate', title: 'babelian-title', panel: '#babelian-writer'},
  {id: 'language-open-babelian-translate', language: 'babelian', mode: 'translate', title: 'babelian-title', panel: '#panel-decode .ocr-card'},
  {id: 'language-open-siren', language: 'siren', mode: 'generate', title: 'siren-title', panel: '#panel-siren .siren-editor-card'},
  {id: 'language-open-siren-translate', language: 'siren', mode: 'translate', title: 'siren-title', panel: '#siren-review-tools'}
];
const variableNames = Object.keys(palettes.babelian).filter(key => key !== 'cycle');
const rgb = hex => `rgb(${[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
const fontNames = value => value.replace(/["']/g, '').split(',').map(name => name.trim().toLowerCase());
const bodyFonts = ['microsoft yahei', 'pingfang sc', 'noto sans cjk sc', 'system-ui', 'sans-serif'];
const headingFonts = ['songti sc', 'noto serif cjk sc', 'simsun', 'georgia', 'serif'];
const readingFonts = ['georgia', 'times new roman', 'microsoft yahei', 'serif'];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})
  });
  try {
    const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:/, route => {
      requests.push(route.request().url());
      return route.abort();
    });
    const appFile = process.env.BABELIAN_APP_FILE || path.resolve(__dirname, '../index.html');
    assert(fs.existsSync(appFile), `Local app does not exist: ${appFile}`);
    await page.goto(pathToFileURL(path.resolve(appFile)).href);
    await page.waitForFunction(() => window.BABELIAN_APP?.navigation && window.BABELIAN_APP?.siren);
    await page.evaluate(() => window.BABELIAN_APP.siren.ready);
    assert.equal(await page.title(), '巴别语与塞壬语翻译器 · Babelian & Siren Translator');
    assert.deepEqual(await page.locator('.language-choice strong').allTextContents(),
      ['巴别语生成', '巴别语翻译', '塞壬语生成', '塞壬语翻译']);

    const qaDir = path.join(__dirname, 'qa');
    if (process.env.UI_THEME_SCREENSHOTS !== '0') fs.mkdirSync(qaDir, {recursive: true});
    const screenshot = async name => {
      if (process.env.UI_THEME_SCREENSHOTS !== '0') {
        await page.screenshot({path: path.join(qaDir, `theme-${name}.png`), fullPage: true});
      }
    };
    const themeSnapshot = selector => page.locator(selector).first().evaluate((element, names) => {
      const style = getComputedStyle(element);
      return {
        variables: Object.fromEntries(names.map(name => [name, style.getPropertyValue(name).trim().toLowerCase()])),
        background: style.backgroundColor,
        color: style.color,
        border: style.borderLeftColor,
        topBorder: style.borderTopColor,
        font: style.fontFamily,
        shadow: style.boxShadow,
        radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius]
      };
    }, variableNames);
    const assertPalette = (actual, language, label) => {
      for (const name of variableNames) {
        assert.equal(actual.variables[name], palettes[language][name], `${label}: ${name}`);
      }
    };
    const assertNoOverflow = async label => {
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth
      }));
      assert(dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport,
        `${label}: horizontal page overflow ${JSON.stringify(dimensions)}`);
    };
    const assertSquareSurfaces = async label => {
      const failures = await page.evaluate(() => {
        const targets = [...document.querySelectorAll('button,.sheet,.mapping-card,.ocr-card,.siren-card,.language-choice')];
        return targets.filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
          .flatMap(element => {
            const style = getComputedStyle(element);
            const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius];
            const name = element.id || `${element.tagName.toLowerCase()}.${element.className}`;
            const problems = [];
            if (radii.some(radius => parseFloat(radius) !== 0)) problems.push(`${name}: radius ${radii.join('/')}`);
            // An inset active-profile marker is not a floating/drop shadow.
            if (style.boxShadow !== 'none' && !style.boxShadow.includes('inset')) problems.push(`${name}: shadow ${style.boxShadow}`);
            return problems;
          });
      });
      assert.deepEqual(failures, [], `${label}: square, shadow-free buttons and cards`);
    };
    const assertKeyboardFocus = async (selector, language, label) => {
      // Put the browser in keyboard modality, then focus the chosen real control.
      await page.keyboard.press('Tab');
      await page.locator(selector).first().focus();
      const focus = await page.locator(selector).first().evaluate(element => {
        const style = getComputedStyle(element);
        return {active: document.activeElement === element, visible: element.matches(':focus-visible'),
          width: parseFloat(style.outlineWidth), style: style.outlineStyle,
          color: style.outlineColor, offset: parseFloat(style.outlineOffset)};
      });
      assert(focus.active && focus.visible, `${label}: keyboard focus must be visible`);
      assert(focus.width >= 2 && focus.style === 'solid' && focus.offset >= 2,
        `${label}: focus must have a separated solid outline ${JSON.stringify(focus)}`);
      assert.equal(focus.color, rgb(palettes[language]['--accent-strong']), `${label}: language-specific focus color`);
    };

    const initialHome = await themeSnapshot('body');
    assert.equal(initialHome.background, rgb('#f6f3ed'), 'Home keeps its neutral paper background');
    const assertHome = async label => {
      assert(await page.locator('#language-home').isVisible(), `${label}: home is visible`);
      assert.equal(await page.evaluate(() => document.body.dataset.language), 'home', `${label}: home language attribute`);
      assert.equal(await page.evaluate(() => document.body.hasAttribute('data-cycle')), false, `${label}: home has no stale cycle`);
      assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#f6f3ed', `${label}: home browser theme color`);
      await page.mouse.move(1, 1);
      assert.deepEqual(await themeSnapshot('body'), initialHome, `${label}: no previous language colors leak into home`);
      assert.deepEqual(fontNames(initialHome.font), bodyFonts, `${label}: Assistant body font stack`);
      for (const entry of entries) {
        const card = await themeSnapshot(`#${entry.id}`);
        assertPalette(card, entry.language, `${label}/${entry.id}`);
        assert.equal(card.background, rgb(palettes[entry.language]['--panel']), `${label}/${entry.id}: card paper`);
        assert.equal(card.border, rgb(palettes[entry.language]['--line']), `${label}/${entry.id}: thin border color`);
        assert.equal(card.topBorder, rgb(palettes[entry.language]['--accent-strong']), `${label}/${entry.id}: top language rule`);
        assert.deepEqual(fontNames(await page.locator(`#${entry.id} strong`).evaluate(element => getComputedStyle(element).fontFamily)),
          headingFonts, `${label}/${entry.id}: serif title stack`);
      }
      await assertSquareSurfaces(label);
      await assertNoOverflow(label);
    };
    const enter = async entry => {
      if (!(await page.locator('#language-home').isVisible())) await page.locator('#language-back').click();
      await page.locator(`#${entry.id}`).click();
      if (entry.language === 'siren') {
        const mode = entry.mode === 'translate' ? 'review' : 'generate';
        await page.waitForFunction(expected => window.BABELIAN_APP.siren.snapshot().mode === expected, mode);
      }
    };

    for (const width of [1400, 390]) {
      await page.setViewportSize({width, height: 1000});
      await assertHome(`home/${width}`);
      for (const entry of entries) {
        await assertKeyboardFocus(`#${entry.id}`, entry.language, `home/${width}/${entry.id}`);
        await page.locator(`#${entry.id}`).hover();
        assert.equal((await themeSnapshot(`#${entry.id}`)).background, rgb(palettes[entry.language]['--accent-soft']),
          `home/${width}/${entry.id}: hover uses cycle soft accent`);
        await page.mouse.move(1, 1);
      }
      await page.locator(`#${entries.at(-1).id}`).blur();
      await screenshot(`home-${width}`);
      for (const entry of entries) {
        const label = `${entry.language}-${entry.mode}/${width}`;
        await enter(entry);
        assert.equal(await page.evaluate(() => document.body.dataset.language), entry.language, `${label}: language attribute`);
        assert.equal(await page.evaluate(() => document.body.dataset.cycle), palettes[entry.language].cycle, `${label}: cycle attribute`);
        assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), palettes[entry.language]['--bg'], `${label}: browser theme color`);
        const body = await themeSnapshot('body');
        assertPalette(body, entry.language, label);
        assert.equal(body.background, rgb(palettes[entry.language]['--bg']), `${label}: cycle page background`);
        assert.deepEqual(fontNames(body.font), bodyFonts, `${label}: body font stack`);
        assert.deepEqual(fontNames(await page.locator(`#${entry.title}`).evaluate(element => getComputedStyle(element).fontFamily)),
          headingFonts, `${label}: serif heading font stack`);
        assert.equal(await page.evaluate(() => document.activeElement.id), entry.title, `${label}: entering focuses the heading`);
        const panel = await themeSnapshot(entry.panel);
        assert.equal(panel.background, rgb(palettes[entry.language]['--panel']), `${label}: cycle panel paper`);
        assert.equal(panel.border, rgb(palettes[entry.language]['--line']), `${label}: cycle panel border`);
        const formatted = entry.language === 'babelian' ? '#ocr-formatted' : '#siren-formatted';
        const chinese = entry.language === 'babelian' ? '#ocr-translation' : '#siren-chinese';
        assert.deepEqual(fontNames(await page.locator(formatted).evaluate(element => getComputedStyle(element).fontFamily)),
          readingFonts, `${label}: readable English suggestion font stack`);
        assert.deepEqual(fontNames(await page.locator(chinese).evaluate(element => getComputedStyle(element).fontFamily)),
          bodyFonts, `${label}: Chinese result font stack`);
        const openDetails = await page.locator('details[open]').evaluateAll(elements => elements.filter(element => element.getClientRects().length).length);
        assert.equal(openDetails, 0, `${label}: optional details stay collapsed by default`);
        if (entry.language === 'babelian') {
          assert.equal(await page.locator('#babelian-writer').isVisible(), entry.mode === 'generate', `${label}: correct writer visibility`);
          assert.equal(await page.locator('#panel-decode').isVisible(), entry.mode === 'translate', `${label}: correct OCR visibility`);
        } else {
          assert.equal(await page.locator('#siren-review-tools').isVisible(), entry.mode === 'translate', `${label}: correct review visibility`);
          assert.equal(await page.locator('#siren-generate-tools').isVisible(), entry.mode === 'generate', `${label}: correct generation visibility`);
          assert.equal(await page.locator('#siren-precision-panel').isVisible(), false, `${label}: precision tools stay collapsed`);
          assert.equal(await page.locator('#siren-keyboard-panel').isVisible(), false, `${label}: optional keyboard stays collapsed`);
        }
        await assertSquareSurfaces(label);
        await assertKeyboardFocus('#language-back', entry.language, label);
        await assertNoOverflow(label);
        await page.locator('#language-back').blur();
        await page.mouse.move(1, 1);
        await screenshot(`${entry.language}-${entry.mode}-${width}`);
        await page.locator('#language-back').click();
        assert.equal(await page.evaluate(() => document.activeElement.id), entry.id, `${label}: back returns focus to the originating card`);
        await assertHome(`returned-from-${label}`);
      }
    }

    // Exercise theme switching with real drafts, without rerunning OCR algorithms.
    await enter(entries[0]);
    const draft = 'Keep My Draft\nBabelian and Siren';
    await page.locator('#english-input').fill(draft);
    await enter(entries[2]);
    await page.locator('#siren-open-add').click();
    await page.getByRole('button', {name: '塞壬字母 A', exact: true}).click();
    const sirenDraft = await page.evaluate(() => JSON.stringify(window.BABELIAN_APP.siren.snapshot()));
    assert.equal(JSON.parse(sirenDraft).groups[0].items[0].letter, 'A', 'Siren draft is a real generated letter');
    await enter(entries[1]);
    assert.equal(await page.locator('#english-input').inputValue(), draft, 'Babelian draft survives switching languages and entering translation');
    await enter(entries[3]);
    assert.equal((await page.evaluate(() => window.BABELIAN_APP.siren.snapshot())).groups.length, 0, 'Siren translation keeps its independent review state');
    await enter(entries[0]);
    assert.equal(await page.locator('#english-input').inputValue(), draft, 'Babelian draft is unchanged after returning from Siren translation');
    await enter(entries[2]);
    assert.equal(await page.evaluate(() => JSON.stringify(window.BABELIAN_APP.siren.snapshot())), sirenDraft,
      'Siren generated draft survives Babelian and independent Siren translation themes');
    await assertNoOverflow('siren-draft/mobile');
    await page.locator('#language-back').click();
    await assertHome('home-after-both-drafts');

    assert.deepEqual(errors, [], 'No browser or console errors');
    assert.deepEqual(requests, [], 'Opening, switching and generating remain offline');
    console.log('PASS exact C4/C5 palettes, neutral home reset, four direct entries at 1400/390 px, Assistant fonts, square shadow-free surfaces, keyboard focus, collapsed details, independent retained drafts; no errors or HTTP requests.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
