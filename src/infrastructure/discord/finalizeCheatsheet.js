const sections = [
  '**Categorie 0**',
  '- Race incident **[NFA]**',
  '',
  '**Categorie 0 [+]**',
  '- Niet racen maar op de baan blijven',
  '- Expres leaven / rage quit',
  '- Respawnen in pits (kwalificatie)',
  '- Getunede auto / drivers agreement schenden',
  '- Onsportief gedrag (spookrijden, wallride, etc.)',
  '',
  '**Categorie 1**',
  '- Agressief aanvallen (zonder positie verlies)',
  '- Blauwe vlag negeren',
  '- Niet op omgeving letten',
  '- Herhaaldelijk aantikken',
  '- Penalty burnen op racelijn',
  '- Slechte aansluiting rollende start (>3 lengtes)',
  '',
  '**Categorie 2**',
  '- Agressief aanvallen / verdedigen',
  '- Van baan drukken / geen ruimte laten',
  '- Onveilig terugkomen op baan',
  '- Opzettelijk hinderen (kwalificatie)',
  '',
  '**Categorie 3**',
  '- Iemand van baan afrijden',
  '- Startprocedures niet naleven',
  '- Incident tijdens formatieronde',
  '- Ghosten > 2 ronden',
  '',
  '**Categorie 4**',
  '- Kettingbotsing veroorzaken',
  '- Expres iemand van baan rijden',
  '',
  '**Categorie 5**',
  '- Startincident verhoogd naar cat 5',
  '- Verbaal aanvallen / discriminatie'
];

const buildFinalizeCheatsheetContent = ({ expanded = false } = {}) => {
  if (!expanded) {
    return '📚 **Cheatsheet**\nKlik op **Toon cheatsheet** om de categorie-uitleg uit te klappen.';
  }
  return `📚 **Cheatsheet**\n${sections.join('\n')}`;
};

module.exports = {
  buildFinalizeCheatsheetContent
};
