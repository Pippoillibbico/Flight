import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshOurAirportsCatalog, readOurAirportsCatalog } from '../server/lib/ourairports-catalog.js';

const CSV_FIXTURES = {
  'airports.csv': [
    'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,gps_code,iata_code,local_code,home_link,wikipedia_link,keywords',
    '4330,LIRF,large_airport,Rome-Fiumicino Leonardo da Vinci International Airport,41.8003,12.2389,15,EU,IT,IT-62,Rome,yes,LIRF,FCO,RM11,,,',
    '1525,YMPC,small_airport,Merty Merty Airport,-28.5833,140.3,50,OC,AU,AU-SA,Merty Merty,no,YMPC,RTY,,,',
    '9999,ZZZZ,closed,Fake Test Airport,0,0,0,EU,IT,IT-62,Nowhere,no,ZZZZ,QWE,,,'
  ].join('\n'),
  'countries.csv': ['id,code,name,continent,wikipedia_link,keywords', 'IT,IT,Italy,EU,,', 'AU,AU,Australia,OC,,'].join('\n'),
  'regions.csv': [
    'id,code,local_code,name,continent,iso_country,wikipedia_link,keywords',
    'IT-62,IT-62,62,Lazio,EU,IT,,',
    'AU-SA,AU-SA,SA,South Australia,OC,AU,,'
  ].join('\n'),
  'airport-frequencies.csv': 'id,airport_ref,airport_ident,type,description,frequency_mhz\n1,4330,LIRF,TWR,Tower,118.7\n',
  'airport-comments.csv': 'id,threadRef,airportRef,airportIdent,date,memberNickname,subject,body\n1,1,4330,LIRF,2026-01-01,user,subject,body\n',
  'runways.csv': 'id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed\n1,4330,LIRF,12000,150,ASP,1,0\n',
  'navaids.csv': 'id,filename,ident,name,type,frequency_khz,latitude_deg,longitude_deg,elevation_ft,iso_country,dme_frequency_khz,dme_channel,dme_latitude_deg,dme_longitude_deg,dme_elevation_ft,slaved_variation_deg,magnetic_variation_deg,usageType,power,associated_airport\n1,x,ROM,Rome,VOR,110000,41,12,0,IT,,,,,,,,,LIRF\n'
};

function createFixtureFetch() {
  return async (url) => {
    const filename = String(url).split('/').pop();
    const body = CSV_FIXTURES[filename];
    if (!body) {
      return { ok: false, status: 404, headers: new Map(), text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-length', String(Buffer.byteLength(body))]]),
      text: async () => body
    };
  };
}

test('ourairports refresh stores useful flight catalog and audits ignored datasets by count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flight-ourairports-'));
  const catalogPath = join(dir, 'catalog.json');
  try {
    const result = await refreshOurAirportsCatalog({ catalogPath, fetchImpl: createFixtureFetch() });
    assert.equal(result.status, 'updated');
    assert.equal(result.iataCodes, 2);
    assert.equal(typeof result.sourceChecksum, 'string');
    assert.equal(result.datasets.airports.useful, true);
    assert.equal(result.datasets.comments.useful, false);

    const catalog = await readOurAirportsCatalog({ catalogPath });
    assert.equal(catalog.airportsByIata.FCO.municipality, 'Rome');
    assert.equal(catalog.sourceChecksum, result.sourceChecksum);
    assert.equal(catalog.airportsByIata.RTY.countryCode, 'AU');
    assert.equal(catalog.airportsByIata.QWE, undefined);
    assert.equal(catalog.countries.IT.name, 'Italy');
    assert.equal(catalog.regions['IT-62'].name, 'Lazio');
    assert.equal(catalog.datasets.runways.rows, 1);
    assert.equal(catalog.datasets.navaids.useful, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ourairports refresh skips catalog rewrite when source datasets are unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flight-ourairports-'));
  const catalogPath = join(dir, 'catalog.json');
  try {
    const first = await refreshOurAirportsCatalog({ catalogPath, fetchImpl: createFixtureFetch() });
    const catalogBefore = await readOurAirportsCatalog({ catalogPath });

    const second = await refreshOurAirportsCatalog({ catalogPath, fetchImpl: createFixtureFetch() });
    const catalogAfter = await readOurAirportsCatalog({ catalogPath });

    assert.equal(first.status, 'updated');
    assert.equal(second.status, 'unchanged');
    assert.equal(second.sourceChecksum, first.sourceChecksum);
    assert.equal(catalogAfter.generatedAt, catalogBefore.generatedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
