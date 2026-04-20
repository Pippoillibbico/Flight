import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadTextFile, openJsonPayloadInNewTab } from '../../src/features/app-shell/hooks/operations/browser-export-utils.js';

test('openJsonPayloadInNewTab opens tab and schedules URL revocation', async () => {
  const opened = [];
  const createdUrls = [];
  const revoked = [];

  const urlApi = {
    createObjectURL(blob) {
      createdUrls.push(blob);
      return 'blob://payload';
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  };
  const windowObject = {
    open(url, target, flags) {
      opened.push({ url, target, flags });
    }
  };

  const result = openJsonPayloadInNewTab({ ok: true }, { windowObject, urlApi, revokeAfterMs: 1 });
  assert.equal(result, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, 'blob://payload');
  assert.equal(opened[0].target, '_blank');
  assert.equal(createdUrls.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(revoked, ['blob://payload']);
});

test('downloadTextFile writes anchor and revokes URL', () => {
  const bodyChildren = [];
  const clicked = [];
  const revoked = [];
  const created = [];

  const fakeLink = {
    href: '',
    download: '',
    click() {
      clicked.push('clicked');
    },
    remove() {
      const index = bodyChildren.indexOf(this);
      if (index >= 0) bodyChildren.splice(index, 1);
    }
  };
  const documentObject = {
    body: {
      appendChild(node) {
        bodyChildren.push(node);
      }
    },
    createElement(tagName) {
      assert.equal(tagName, 'a');
      return fakeLink;
    }
  };
  const urlApi = {
    createObjectURL(blob) {
      created.push(blob);
      return 'blob://csv';
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  };

  const result = downloadTextFile('a,b\n1,2', 'report.csv', {
    documentObject,
    urlApi,
    mimeType: 'text/csv;charset=utf-8'
  });

  assert.equal(result, true);
  assert.equal(fakeLink.href, 'blob://csv');
  assert.equal(fakeLink.download, 'report.csv');
  assert.equal(clicked.length, 1);
  assert.equal(bodyChildren.length, 0);
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, ['blob://csv']);
});
