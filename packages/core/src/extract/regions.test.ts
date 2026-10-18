import { describe, expect, it } from 'vitest';
import { splitBlocks } from './blocks.ts';
import { classifyFile, normalizeTitle, regionOfTitle, type FileFacts } from './regions.ts';

function facts(body: string, extra: Partial<FileFacts> = {}): FileFacts {
  const { blocks, rootTypes } = splitBlocks(`<html><body>${body}</body></html>`, 'a.xhtml');
  return { linear: true, rootTypes, tocTitle: null, blocks, ...extra };
}

describe('normalizeTitle / regionOfTitle', () => {
  it('normalizes case, punctuation and spaces in Chinese', () => {
    expect(normalizeTitle('  PRAISE FOR  Piranesi:')).toBe('praise for piranesi');
    expect(normalizeTitle('目 录')).toBe('目录');
    expect(normalizeTitle('【译后记】')).toBe('译后记');
    expect(normalizeTitle('Author’s Note')).toBe("author's note");
  });

  it('maps whole titles to regions', () => {
    expect(regionOfTitle('Copyright')).toBe('copyright');
    expect(regionOfTitle('版权信息')).toBe('copyright');
    expect(regionOfTitle('CONTENTS')).toBe('toc');
    expect(regionOfTitle('Also by Susanna Clarke')).toBe('also-by');
    expect(regionOfTitle('推荐序 一个时代的回声')).toBe('translator');
    expect(regionOfTitle('Introduction')).toBe('preface');
    expect(regionOfTitle('Acknowledgments')).toBe('acknowledgments');
    expect(regionOfTitle('Notes')).toBe('notes');
    expect(regionOfTitle('索引')).toBe('index');
  });

  it('maps titles in other common languages', () => {
    const cases: [string, string][] = [
      ['目錄', 'toc'],
      ['譯後記', 'translator'],
      ['參考文獻', 'bibliography'],
      ['はじめに', 'preface'],
      ['訳注', 'notes'],
      ['奥付', 'copyright'],
      ['차례', 'toc'],
      ['감사의 말', 'acknowledgments'],
      ['저자소개', 'about-author'],
      ['Table des matières', 'toc'],
      ['Remerciements', 'acknowledgments'],
      ['À propos de l’auteur', 'about-author'],
      ['Inhaltsverzeichnis', 'toc'],
      ['Anmerkungen', 'notes'],
      ['Personenregister', 'index'],
      ['Índice', 'toc'],
      ['Índice analítico', 'index'],
      ['Bibliografía', 'bibliography'],
      ['Ringraziamenti', 'acknowledgments'],
      ['Prefazione', 'preface'],
      ['Sumário', 'toc'],
      ['Nota do autor', 'preface'],
      ['Содержание', 'toc'],
      ['Примечания', 'notes'],
    ];
    for (const [title, region] of cases)
      expect([title, regionOfTitle(title)]).toEqual([title, region]);
  });

  it('does not match titles that only contain a keyword', () => {
    expect(regionOfTitle('Notes from Underground')).toBeNull();
    expect(regionOfTitle('An Index of Metals')).toBeNull();
    expect(regionOfTitle('Prologue')).toBeNull();
    expect(regionOfTitle('第一章 序幕')).toBeNull();
    expect(regionOfTitle('序章')).toBeNull();
    expect(regionOfTitle('Inhalt und Form')).toBeNull();
    expect(regionOfTitle('Notes de voyage')).toBeNull();
    expect(regionOfTitle('Prólogo')).toBeNull();
    expect(regionOfTitle('')).toBeNull();
  });
});

describe('classifyFile', () => {
  it('uses epub:type first', () => {
    const f = facts('<section epub:type="index"><h1>Contents</h1><p>x</p></section>');
    expect(classifyFile(f)).toEqual({ region: 'index', reason: 'epub:type=index' });
  });

  it('ignores epub:type words that say nothing about the content', () => {
    const f = facts('<section epub:type="bodymatter chapter"><h1>One</h1><p>x</p></section>');
    expect(classifyFile(f).region).toBe('body');
  });

  it('then uses the toc title', () => {
    const f = facts('<p>Thanks to everyone.</p>', { tocTitle: 'Acknowledgements' });
    expect(classifyFile(f)).toEqual({
      region: 'acknowledgments',
      reason: 'toc title: Acknowledgements',
    });
  });

  it('then the first heading of the file', () => {
    expect(classifyFile(facts('<h2>译后记</h2><p>……</p>'))).toEqual({
      region: 'translator',
      reason: 'first heading: 译后记',
    });
    expect(
      classifyFile(facts('<p class="h1">Praise for Piranesi</p><p>Wonderful.</p>')).region,
    ).toBe('praise');
  });

  it('recognises a copyright page by its content', () => {
    const f = facts('<p>Copyright © 2020 Someone</p><p>All rights reserved.</p><p>ISBN 978-0</p>');
    expect(classifyFile(f)).toEqual({
      region: 'copyright',
      reason: 'content: ISBN, ©, all rights reserved',
    });
    const zh = facts('<p>图书在版编目（CIP）数据</p><p>定价：58.00元</p>');
    expect(classifyFile(zh).region).toBe('copyright');
    const fr = facts(
      '<p>© Éditions X, 2019</p><p>Tous droits réservés.</p><p>Dépôt légal : mai 2019</p>',
    );
    expect(classifyFile(fr).region).toBe('copyright');
    const ja = facts(
      '<p>2020年5月 第1刷発行</p><p>本書の無断複製は禁じられています。</p><p>ISBN978-4</p>',
    );
    expect(classifyFile(ja).region).toBe('copyright');
  });

  it('recognises notes and an index by their lines', () => {
    const notes = facts(
      Array.from({ length: 12 }, (_, i) => `<p>${i + 1}. Darwin, Origin, ${i}.</p>`).join(''),
    );
    expect(classifyFile(notes).region).toBe('notes');
    const index = facts(
      Array.from({ length: 12 }, (_, i) => `<p>fossils, ${i + 3}, 45–48</p>`).join(''),
    );
    expect(classifyFile(index).region).toBe('index');
  });

  it('recognises a contents page made of links', () => {
    const toc = facts(
      Array.from({ length: 12 }, (_, i) => `<p><a href="ch${i}.xhtml">Chapter ${i}</a></p>`).join(
        '',
      ),
    );
    expect(classifyFile(toc).region).toBe('toc');
  });

  it('does not use content statistics on short files', () => {
    const f = facts('<p>1. One</p><p>2. Two</p>');
    expect(classifyFile(f).region).toBe('body');
  });

  it('falls back to auxiliary for linear=no, otherwise body', () => {
    expect(classifyFile(facts('<p>Something</p>', { linear: false }))).toEqual({
      region: 'auxiliary',
      reason: 'linear=no',
    });
    expect(classifyFile(facts('<h1>The Lost Hall</h1><p>It was cold.</p>'))).toEqual({
      region: 'body',
      reason: '',
    });
  });
});
