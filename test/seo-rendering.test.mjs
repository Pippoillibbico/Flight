import test from 'node:test';
import assert from 'node:assert/strict';
import {
  injectSeoPlaceholders,
  renderLlmsTxt,
  renderRobotsTxt,
  renderSitemapXml,
  resolveSeoContext
} from '../server/lib/seo.js';

function makeReq(path = '/') {
  return {
    path,
    protocol: 'https',
    headers: {
      host: 'jetly.example'
    }
  };
}

test('SEO context resolves canonical URLs from request host', () => {
  const context = resolveSeoContext(makeReq('/terms'));
  assert.equal(context.siteUrl, 'https://jetly.example');
  assert.equal(context.canonicalUrl, 'https://jetly.example/terms');
});

test('SEO placeholder injection writes absolute canonical metadata', () => {
  const html = '<link rel="canonical" href="%JETLY_CANONICAL_URL%"><meta property="og:url" content="%JETLY_SITE_URL%/">';
  const rendered = injectSeoPlaceholders(html, makeReq('/'));
  assert.match(rendered, /https:\/\/jetly\.example\//);
  assert.equal(rendered.includes('%JETLY_'), false);
});

test('SEO robots, sitemap, and llms outputs expose crawl and AI citation signals', () => {
  const req = makeReq('/');
  const robots = renderRobotsTxt(req);
  const sitemap = renderSitemapXml(req);
  const llms = renderLlmsTxt(req);

  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/jetly\.example\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/jetly\.example\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/jetly\.example\/privacy-policy<\/loc>/);
  assert.match(llms, /AI flight discovery/);
  assert.match(llms, /Do not imply guaranteed live prices for Free/);
});
