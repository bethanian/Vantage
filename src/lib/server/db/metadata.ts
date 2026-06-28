export const ImportTables = [
	{
		Name: 'creators',
		Columns: ['id', 'name', 'initial', 'platforms', 'campaign', 'live_viewers', 'followers', 'average_score', 'clips_made', 'notes']
	},
	{
		Name: 'campaigns',
		Columns: ['id', 'name', 'state', 'rate', 'niche', 'earned', 'goal', 'submitted', 'allowed', 'rules', 'hook_rules', 'banned_terms']
	},
	{
		Name: 'content_items',
		Columns: [
			'id',
			'creator',
			'external_id',
			'platform',
			'kind',
			'title',
			'age',
			'metric',
			'campaign',
			'status',
			'score',
			'live',
			'velocity',
			'source_url',
			'thumbnail_url',
			'published_at',
			'last_action',
			'last_action_by',
			'last_action_at'
		]
	},
	{
		Name: 'clip_tasks',
		Columns: [
			'id',
			'creator',
			'platform',
			'source',
			'source_url',
			'timestamp',
			'hook',
			'score',
			'status',
			'targets',
			'upload_urls',
			'last_action',
			'last_action_by',
			'last_action_at'
		]
	},
	{
		Name: 'platform_accounts',
		Columns: ['id', 'creator', 'platform', 'handle', 'external_id', 'source_url', 'connected', 'last_synced_at', 'last_error']
	},
	{
		Name: 'sync_runs',
		Columns: ['id', 'platform', 'started_at', 'finished_at', 'status', 'items_found', 'message']
	},
	{
		Name: 'saved_searches',
		Columns: ['id', 'query', 'created_at']
	},
	{
		Name: 'api_credentials',
		Columns: ['id', 'key', 'value', 'updated_at']
	},
	{
		Name: 'app_settings',
		Columns: ['id', 'key', 'value']
	},
	{
		Name: 'activity_events',
		Columns: ['id', 'actor', 'action', 'entity_type', 'entity_id', 'label', 'created_at']
	}
] as const;

export const ScoreWeightKeys = [
	'ScoreRecencyWeight',
	'ScoreEngagementWeight',
	'ScorePlatformWeight',
	'ScoreCampaignWeight',
	'ScoreTitleWeight',
	'ScoreStatusWeight'
];
