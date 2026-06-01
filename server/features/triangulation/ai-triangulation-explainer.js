export async function explainTriangulationResults({ results = [], aiRunner = null, aiProvider = 'auto' } = {}) {
  const top = Array.isArray(results) ? results.slice(0, 3) : [];
  if (!top.length) {
    return {
      summary: 'Nessuna triangolazione conveniente trovata con i limiti correnti.',
      bestFor: null,
      notRecommendedFor: null,
      warnings: []
    };
  }

  if (typeof aiRunner === 'function' && aiProvider !== 'none') {
    const aiResponse = await aiRunner({
      task: 'triangulation_explain',
      aiProvider,
      prompt:
        'Spiega queste triangolazioni in modo chiaro e onesto. Evidenzia risparmio, rischio, bagaglio, margine tra voli e quando conviene o non conviene. Non inventare informazioni non presenti nei dati.',
      input: { results: top }
    });
    if (aiResponse && typeof aiResponse === 'object') return aiResponse;
    if (typeof aiResponse === 'string' && aiResponse.trim()) {
      return {
        summary: aiResponse.trim(),
        bestFor: 'Viaggiatore flessibile con bagaglio leggero.',
        notRecommendedFor: 'Date rigide, bagaglio da stiva o bassa tolleranza al rischio.',
        warnings: top[0]?.warnings || []
      };
    }
  }

  const best = top[0];
  return {
    summary: `La soluzione migliore e ${best.route.replaceAll('-', ' -> ')}: risparmio stimato ${best.savingVsBaseline} EUR, rischio ${best.risk}, score ${best.score}/100.`,
    bestFor: 'Viaggiatore flessibile con zaino o bagaglio a mano.',
    notRecommendedFor: 'Chi ha bagaglio da stiva, date rigide o non vuole self-transfer.',
    warnings: best.warnings || []
  };
}
