import { describe, expect, it } from 'vitest';
import { sanitizeBlock } from './sanitize.ts';

describe('sanitizeBlock', () => {
  it('takes the inside of a single block element and drops attributes', () => {
    expect(sanitizeBlock('<p class="indent" id="p3">Hello <i class="x">there</i>.</p>')).toBe(
      'Hello <i>there</i>.',
    );
  });

  it('keeps loose text and inline tags when there is no outer element', () => {
    expect(sanitizeBlock('Loose <b>text</b> here')).toBe('Loose <b>text</b> here');
  });

  it('unwraps links, spans and unknown tags', () => {
    expect(
      sanitizeBlock('<p><a href="x.html#a">Link</a> <span class="c"><font>red</font></span></p>'),
    ).toBe('Link red');
  });

  it('drops images, note references and page markers', () => {
    expect(
      sanitizeBlock(
        '<p>Text<img src="a.jpg"/><sup><a href="#fn1">1</a></sup> more' +
          '<span epub:type="pagebreak" id="page5">5</span> end</p>',
      ),
    ).toBe('Text more end');
  });

  it('decodes HTML entities and escapes only & < >', () => {
    expect(sanitizeBlock('<p>A&nbsp;B &amp; C &lt;D&gt; &#x4E2D;&mdash;</p>')).toBe(
      'A\u00a0B &amp; C &lt;D&gt; 中—',
    );
  });

  it('keeps line breaks and adds spaces between table cells', () => {
    expect(sanitizeBlock('<p>Line one<br />line two</p>')).toBe('Line one<br/>line two');
    expect(sanitizeBlock('<table><tr><td>A</td><td>B</td></tr></table>')).toBe('A B');
  });
});
