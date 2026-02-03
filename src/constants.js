const incidentReasons = [
  { label: 'Blauwe vlaggen negeren', value: 'blauwe_vlaggen' },
  { label: 'Penalty burnen op de racelijn', value: 'penalty_burnen' },
  { label: 'Niet op de hoogt van omgeving', value: 'niet_op_hoogte' },
  { label: 'Herhaaldelijk de auto aanstoten', value: 'auto_aanstoten' },
  { label: 'Geen ruimte laten', value: 'geen_ruimte' },
  { label: 'De baan onveilig opkomen', value: 'onveilig_opkomen' },
  { label: 'Van de baan rijden', value: 'van_de_baan' },
  { label: 'Kettingbotsing veroorzaken', value: 'kettingbotsing' },
  { label: 'Anders', value: 'anders' }
];

const evidenceButtonIds = {
  more: 'evidence_more',
  done: 'evidence_done'
};

// wachttijd van bewijsmateriaal
const evidenceWindowMs = 10 * 60 * 1000;
const incidentReportWindowMs = 5 * 60 * 1000;
const appealWindowMs = 5 * 60 * 1000;
const finalizeWindowMs = 5 * 60 * 1000;
const guiltyReplyWindowMs = 2 * 24 * 60 * 60 * 1000;

module.exports = {
  incidentReasons,
  evidenceButtonIds,
  evidenceWindowMs,
  incidentReportWindowMs,
  appealWindowMs,
  finalizeWindowMs,
  guiltyReplyWindowMs
};
