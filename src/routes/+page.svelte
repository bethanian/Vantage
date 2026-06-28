<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		type ClipTask,
		type ContentItem,
		type ItemStatus,
		type Platform,
		type PlatformAccount,
		type ViewName
	} from '$lib/vantage-data';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const Campaigns = $derived(data.Campaigns);
	const ApiCredentials = $derived(data.ApiCredentials);
	const AppSettings = $derived(data.AppSettings);
	const ClipTasks = $derived(data.ClipTasks);
	const ContentItems = $derived(data.ContentItems);
	const Creators = $derived(data.Creators);
	const PlatformAccounts = $derived(data.PlatformAccounts);
	const SavedSearches = $derived(data.SavedSearches);
	const SyncRuns = $derived(data.SyncRuns);
	const ActivityEvents = $derived(data.ActivityEvents);

	const Views: ViewName[] = ['Feed', 'Creators', 'Queue', 'Campaigns', 'Accounts'];
	const FeedFilters = ['All', 'Live now', 'Whop', 'Clipping.net', 'Not clipped'];
	const ContentStatusActions: { Status: ItemStatus; Icon: string; Label: string }[] = [
		{ Status: 'Watched', Icon: 'ti-eye', Label: 'Mark watched' },
		{ Status: 'Clipped', Icon: 'ti-scissors', Label: 'Mark clipped' },
		{ Status: 'Rejected', Icon: 'ti-circle-x', Label: 'Reject' }
	];
	const QueueFilters = ['All', 'To upload', 'Editing', 'Done'];
	const SortModes = ['Opportunity score', 'Recency', 'Creator', 'Engagement velocity'];
	const SidebarGroups = $derived([
		{
			Label: 'Platforms',
			Items: [
				{ Label: 'All sources', Icon: 'ti-layout-list', Filter: 'All', Count: ContentItems.length },
				{ Label: 'Kick', Icon: 'ti-brand-kick', Filter: 'Kick', Count: PlatformCount('Kick') },
				{ Label: 'Twitch', Icon: 'ti-brand-twitch', Filter: 'Twitch', Count: PlatformCount('Twitch') },
				{ Label: 'YouTube', Icon: 'ti-brand-youtube', Filter: 'YouTube', Count: PlatformCount('YouTube') },
				{ Label: 'TikTok', Icon: 'ti-brand-tiktok', Filter: 'TikTok', Count: PlatformCount('TikTok') }
			]
		},
		{
			Label: 'Campaigns',
			Items: [
				...Campaigns.map((Campaign) => ({
					Label: Campaign.Name,
					Icon: 'ti-tag',
					Filter: Campaign.Name,
					Count: ContentItems.filter((Item) => Item.Campaign === Campaign.Name).length
				}))
			]
		},
		{
			Label: 'Status',
			Items: [
				{ Label: 'Unwatched', Icon: 'ti-circle-dot', Filter: 'New', Count: ContentItems.filter((Item) => Item.Status === 'New').length },
				{ Label: 'In queue', Icon: 'ti-clock', Filter: 'Queue', Count: ClipTasks.length },
				{ Label: 'Uploaded', Icon: 'ti-check', Filter: 'Uploaded', Count: ContentItems.filter((Item) => Item.Status === 'Uploaded').length }
			]
		}
	]);

	let ActiveView = $state<ViewName>('Feed');
	let ActiveFeedFilter = $state('All');
	let FeedSearch = $state('');
	let SourceSearch = $state('');
	let ActiveQueueFilter = $state('All');
	let SortMode = $state(SortModes[0]);
	let SelectedCreatorName = $state(InitialCreatorName());
	let QueueState = $state<ClipTask[]>(InitialQueueState());
	let EditableNotes = $state<Record<string, string>>(InitialNotes());
	let IsSyncingYoutube = $state(false);
	let IsSyncingTwitch = $state(false);
	let IsSyncingKick = $state(false);
	let IsSyncingAll = $state(false);
	let IsResolvingSources = $state(false);
	let ActorName = $state('');
	let ActorDraft = $state('');
	let NeedsActor = $state(true);

	const SelectedCreator = $derived(
		Creators.find((Creator) => Creator.Name === SelectedCreatorName) ?? Creators[0]
	);
	const LiveCount = $derived(ContentItems.filter((Item) => Item.Live).length);
	const Earnings = $derived(Campaigns.reduce((Total, Campaign) => Total + Campaign.Earned, 0));
	const EarningsGoal = $derived(Campaigns.reduce((Total, Campaign) => Total + Campaign.Goal, 0));
	const AverageScore = $derived(ContentItems.length ? Math.round(ContentItems.reduce((Total, Item) => Total + Item.Score, 0) / ContentItems.length) : 0);
	const UploadedCount = $derived(QueueState.filter((Task) => Object.values(Task.UploadUrls).some(Boolean) || Task.Status === 'Done').length);
	const HandledCount = $derived(ContentItems.filter((Item) => ['Watched', 'Clipped', 'Uploaded', 'Rejected'].includes(Item.Status)).length);
	const ClippedCount = $derived(QueueState.length + ContentItems.filter((Item) => ['Clipped', 'Uploaded'].includes(Item.Status)).length);
	const UploadPlatformStats = $derived(
		[
			{ Platform: 'TikTok' as const, Key: 'TikTok' as const },
			{ Platform: 'YouTube' as const, Key: 'Shorts' as const },
			{ Platform: 'Instagram' as const, Key: 'Reels' as const }
		].map(({ Platform, Key }) => ({
			Platform,
			Uploads: QueueState.filter((Task) => Boolean(Task.UploadUrls[Key])).length,
			Queued: QueueState.filter((Task) => Task.Targets[Key]).length
		}))
	);
	const LatestSync = $derived(SyncRuns.at(-1));
	const SelectedCampaign = $derived(Campaigns.find((Campaign) => Campaign.Name === SelectedCreator.Campaign));
	const FeedItems = $derived.by(() => {
		const Filtered = ContentItems.filter(
			(Item) =>
				Item.Score >= AppSettings.MinimumScore &&
				MatchesFeedFilter(Item, ActiveFeedFilter) &&
				MatchesSearch(Item, FeedSearch)
		);
		return [...Filtered].sort((A, B) => {
			if (SortMode === 'Creator') return A.Creator.localeCompare(B.Creator);
			if (SortMode === 'Recency') return B.Id - A.Id;
			return B.Score - A.Score;
		});
	});
	const LeadItems = $derived(FeedItems.slice(0, 3));
	const QueueItems = $derived(QueueState.filter((Task) => MatchesQueueFilter(Task, ActiveQueueFilter)));
	const SourceAccounts = $derived(PlatformAccounts.filter((Account) => MatchesSourceSearch(Account)));
	const SourceGroups = $derived.by(() => {
		const Groups = new Map<string, PlatformAccount[]>();
		for (const Account of SourceAccounts) Groups.set(Account.Platform, [...(Groups.get(Account.Platform) ?? []), Account]);
		return [...Groups.entries()].map(([Platform, Accounts]) => ({ Platform, Accounts }));
	});
	const CreatorItems = $derived(
		ContentItems.filter((Item) => Item.Creator === SelectedCreator.Name).slice(0, 5)
	);
	const ScoreWeights = $derived([
		{ Key: 'ScoreRecencyWeight', Label: 'Recency', Value: AppSettings.ScoreRecencyWeight },
		{ Key: 'ScoreEngagementWeight', Label: 'Engagement', Value: AppSettings.ScoreEngagementWeight },
		{ Key: 'ScorePlatformWeight', Label: 'Platform fit', Value: AppSettings.ScorePlatformWeight },
		{ Key: 'ScoreCampaignWeight', Label: 'Campaign fit', Value: AppSettings.ScoreCampaignWeight },
		{ Key: 'ScoreTitleWeight', Label: 'Title intent', Value: AppSettings.ScoreTitleWeight },
		{ Key: 'ScoreStatusWeight', Label: 'Status penalty', Value: AppSettings.ScoreStatusWeight }
	]);
	type ToastKind = 'Success' | 'Error' | 'Info';
	let Toasts = $state<{ Id: number; Kind: ToastKind; Message: string }[]>([]);
	let EditingTaskId = $state<number | null>(null);

	onMount(() => {
		const SavedActor = localStorage.getItem('VantageActorName') ?? '';
		ActorName = SavedActor;
		ActorDraft = SavedActor;
		NeedsActor = !SavedActor;
	});

	function MatchesFeedFilter(Item: ContentItem, Filter: string) {
		if (Filter === 'All') return true;
		if (Filter === 'Live now') return Item.Live;
		if (Filter === 'Not clipped') return !['Clipped', 'Uploaded'].includes(Item.Status);
		if (Filter === 'Queue') return QueueState.some((Task) => Task.Creator === Item.Creator);
		return Item.Platform === Filter || Item.Campaign === Filter || Item.Status === Filter;
	}

	function PlatformCount(Platform: Platform) {
		return ContentItems.filter((Item) => Item.Platform === Platform).length;
	}

	function MatchesSearch(Item: ContentItem, Query: string) {
		const Search = Query.trim().toLowerCase();
		if (!Search) return true;
		return [Item.Creator, Item.Platform, Item.Campaign, Item.Kind, Item.Status, Item.Title, Item.Metric]
			.join(' ')
			.toLowerCase()
			.includes(Search);
	}

	function MatchesQueueFilter(Task: ClipTask, Filter: string) {
		if (Filter === 'All') return true;
		if (Filter === 'To upload') return Task.Status !== 'Done';
		return Task.Status === Filter;
	}

	function MatchesSourceSearch(Account: PlatformAccount) {
		const Search = SourceSearch.trim().toLowerCase();
		if (!Search) return true;
		return [Account.Creator, Account.Platform, Account.Handle, Account.ExternalId, Account.SourceUrl ?? '', Account.LastError ?? '']
			.join(' ')
			.toLowerCase()
			.includes(Search);
	}

	function InitialCreatorName() {
		return data.Creators[0]?.Name ?? '';
	}

	function InitialQueueState() {
		return data.ClipTasks.map((Task) => ({
			...Task,
			Targets: { ...Task.Targets },
			UploadUrls: { ...Task.UploadUrls }
		}));
	}

	function InitialNotes() {
		return Object.fromEntries(data.Creators.map((Creator) => [Creator.Name, Creator.Notes]));
	}

	function SetSidebarFilter(Filter: string) {
		ActiveView = 'Feed';
		ActiveFeedFilter = Filter;
	}

	function ScoreClass(Score: number) {
		if (Score >= 80) return 'High';
		if (Score >= 65) return 'Medium';
		return 'Low';
	}

	function PlatformIcon(Platform: Platform) {
		return {
			Kick: 'ti-brand-kick',
			Twitch: 'ti-brand-twitch',
			YouTube: 'ti-brand-youtube',
			TikTok: 'ti-brand-tiktok',
			Instagram: 'ti-brand-instagram',
			X: 'ti-brand-x'
		}[Platform];
	}

	function UploadUrl(Task: ClipTask, Target: string) {
		return Task.UploadUrls[Target as keyof ClipTask['UploadUrls']] ?? '';
	}

	function PushToast(Message: string, Kind: ToastKind = 'Success') {
		const Id = Date.now() + Math.random();
		Toasts = [...Toasts, { Id, Kind, Message }];
		setTimeout(() => (Toasts = Toasts.filter((Toast) => Toast.Id !== Id)), 3200);
	}

	function SaveActor() {
		const CleanActor = ActorDraft.trim().replace(/\s+/g, ' ').slice(0, 40);
		if (!CleanActor) return;
		ActorName = CleanActor;
		ActorDraft = CleanActor;
		NeedsActor = false;
		localStorage.setItem('VantageActorName', CleanActor);
		PushToast(`Using Vantage as ${CleanActor}`, 'Info');
	}

	function LatestAction(Action?: string | null, Actor?: string | null) {
		if (!Action || !Actor) return '';
		return `${Action} - ${Actor}`;
	}

	function FormFeedback(Label: string): SubmitFunction {
		return ({ formData }) => {
			formData.set('Actor', ActorName || ActorDraft || 'Someone');
			return async ({ result, update }) => {
			await update();
			const Failed = result.type === 'failure' || result.type === 'error';
			PushToast(`${Label} ${Failed ? 'failed' : 'saved'}`, Failed ? 'Error' : 'Success');
		};
		};
	}

	async function ToastedFetch(Url: string, Message: string) {
		const Response = await fetch(Url, { method: 'POST', headers: { 'x-vantage-actor': ActorName || ActorDraft || 'Someone' } });
		const Payload = await Response.json().catch(() => ({} as { Message?: string; Status?: string }));
		if (!Response.ok || Payload.Status === 'Failed') PushToast(Payload.Message ?? `${Message} failed`, 'Error');
		else PushToast(Message, 'Success');
	}

	async function UpdateTaskStatus(Task: ClipTask, Status: string) {
		const PreviousStatus = Task.Status;
		Task.Status = Status;
		const Response = await fetch(`/api/clip-tasks/${Task.Id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'x-vantage-actor': ActorName || ActorDraft || 'Someone' },
			body: JSON.stringify({ Status })
		});
		if (!Response.ok) {
			Task.Status = PreviousStatus;
			PushToast('Queue update failed', 'Error');
		} else {
			Task.LastAction = Status;
			Task.LastActionBy = ActorName || ActorDraft || 'Someone';
			Task.LastActionAt = new Date().toISOString();
			PushToast('Queue status saved');
		}
	}

	async function UpdateContentStatus(Item: ContentItem, Status: ItemStatus) {
		const PreviousStatus = Item.Status;
		Item.Status = Status;
		const Response = await fetch(`/api/content-items/${Item.Id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'x-vantage-actor': ActorName || ActorDraft || 'Someone' },
			body: JSON.stringify({ Status })
		});
		if (!Response.ok) {
			Item.Status = PreviousStatus;
			PushToast('Feed status failed', 'Error');
		} else {
			Item.LastAction = Status;
			Item.LastActionBy = ActorName || ActorDraft || 'Someone';
			Item.LastActionAt = new Date().toISOString();
			PushToast('Feed status saved');
		}
	}

	async function SaveCreatorNotes(CreatorName: string) {
		const Response = await fetch(`/api/creators/${encodeURIComponent(CreatorName)}/notes`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', 'x-vantage-actor': ActorName || ActorDraft || 'Someone' },
			body: JSON.stringify({ Notes: EditableNotes[CreatorName] ?? '' })
		});
		PushToast(Response.ok ? 'Notes saved' : 'Notes failed', Response.ok ? 'Success' : 'Error');
	}

	async function SyncYoutube() {
		IsSyncingYoutube = true;
		try {
			await ToastedFetch('/api/sync/youtube', 'YouTube synced');
			await invalidateAll();
		} finally {
			IsSyncingYoutube = false;
		}
	}

	async function SyncTwitch() {
		IsSyncingTwitch = true;
		try {
			await ToastedFetch('/api/sync/twitch', 'Twitch synced');
			await invalidateAll();
		} finally {
			IsSyncingTwitch = false;
		}
	}

	async function SyncKick() {
		IsSyncingKick = true;
		try {
			await ToastedFetch('/api/sync/kick', 'Kick synced');
			await invalidateAll();
		} finally {
			IsSyncingKick = false;
		}
	}

	async function SyncAll() {
		IsSyncingAll = true;
		try {
			await ToastedFetch('/api/sync/all', 'All sources synced');
			await invalidateAll();
		} finally {
			IsSyncingAll = false;
		}
	}

	async function ResolveSources() {
		IsResolvingSources = true;
		try {
			await ToastedFetch('/api/sources/resolve', 'Source IDs resolved');
			await invalidateAll();
		} finally {
			IsResolvingSources = false;
		}
	}
</script>

<svelte:head>
	<title>Vantage - Creator Intelligence</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300&family=DM+Sans:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
	<link
		rel="stylesheet"
		href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css"
	/>
</svelte:head>

<nav class="Topnav">
	<button class="Wordmark" onclick={() => (ActiveView = 'Feed')}>V<em>antage</em></button>
	{#each Views as View}
		<button class:Active={ActiveView === View} class="NavLink" onclick={() => (ActiveView = View)}>
			{View.toLowerCase()}
			{#if View === 'Queue'}<span class="Count">{QueueState.length}</span>{/if}
		</button>
	{/each}
	<div class="NavSpacer"></div>
	<span class="RefreshTag">{LatestSync ? `${LatestSync.Platform} ${LatestSync.Status.toLowerCase()}` : 'not synced yet'}</span>
	<button class="ActorPill" onclick={() => (NeedsActor = true)}>
		<i class="ti ti-user-circle"></i>{ActorName || 'set name'}
	</button>
	<button class="SyncButton" disabled={IsSyncingAll} onclick={SyncAll}>
		<i class="ti ti-refresh"></i>{IsSyncingAll ? 'syncing' : 'sync all'}
	</button>
	<span class="LiveDot">{LiveCount} live</span>
	<span class="Avatar">YO</span>
</nav>

<div class="Shell">
	<aside class="Sidebar">
		{#each SidebarGroups as Group}
			<div class="SidebarLabel">{Group.Label}</div>
			{#each Group.Items as Item}
				<button
					class:Active={ActiveFeedFilter === Item.Filter && ActiveView === 'Feed'}
					class="SidebarItem"
					onclick={() => SetSidebarFilter(Item.Filter)}
				>
					<span><i class={`ti ${Item.Icon}`}></i>{Item.Label}</span>
					<span class="SidebarCount">{Item.Count}</span>
				</button>
			{/each}
			<div class="SidebarDivider"></div>
		{/each}
		<div class="SidebarBottom">
			<button class="SidebarItem" onclick={() => (ActiveView = 'Accounts')}>
				<span><i class="ti ti-settings"></i>Settings</span>
			</button>
		</div>
	</aside>

	<main class="Main">
		{#if ActiveView === 'Feed'}
			<section class="View">
				<div class="ConnectBanner">
					<i class="ti ti-plug-connected"></i>
					<span>YouTube, TikTok, and Instagram are connected. Source tracking starts with Kick, Twitch, and YouTube.</span>
					<button onclick={() => (ActiveView = 'Accounts')}>Manage accounts</button>
				</div>

				<div class="Subheader">
					<span class="SubheaderTitle">Today's feed</span>
					{#each FeedFilters as Filter}
						<button
							class:Active={ActiveFeedFilter === Filter}
							class="Chip"
							onclick={() => (ActiveFeedFilter = Filter)}
						>
							{Filter}
						</button>
					{/each}
					<div class="SubheaderSpacer"></div>
					<div class="SearchWrap">
						<i class="ti ti-search"></i>
						<input bind:value={FeedSearch} aria-label="Search feed" placeholder="Search creator, term, campaign" />
						{#if FeedSearch}
							<button aria-label="Clear search" onclick={() => (FeedSearch = '')}>
								<i class="ti ti-x"></i>
							</button>
						{/if}
					</div>
					<form method="POST" action="?/AddSavedSearch" class="SaveSearchForm" use:enhance={FormFeedback('Search')}>
						<input type="hidden" name="Query" value={FeedSearch.trim()} />
						<button disabled={!FeedSearch.trim()} aria-label="Save search">
							<i class="ti ti-bookmark-plus"></i>
						</button>
					</form>
					<label for="SortMode">Sort by</label>
					<select id="SortMode" bind:value={SortMode}>
						{#each SortModes as Mode}<option>{Mode}</option>{/each}
					</select>
				</div>
				<div class="SavedSearchRow">
					<span>saved searches</span>
					{#each SavedSearches as Search}
						<button class:Active={FeedSearch === Search.Query} onclick={() => (FeedSearch = Search.Query)}>
							{Search.Query}
						</button>
						<form method="POST" action="?/DeleteSavedSearch" use:enhance={FormFeedback('Search')}>
							<input type="hidden" name="Id" value={Search.Id} />
							<button aria-label={`Delete ${Search.Query}`}>
								<i class="ti ti-x"></i>
							</button>
						</form>
					{/each}
				</div>

				<div class="ContentPanes">
					<div class="Feed">
						<div class="LeadGrid">
							{#each LeadItems as Item}
								<div class="LeadCell">
									<button class="LeadMain" onclick={() => (SelectedCreatorName = Item.Creator)}>
										<div class="LeadMedia">
											{#if Item.ThumbnailUrl}
												<img src={Item.ThumbnailUrl} alt="" loading="lazy" />
											{:else}
												<i class={`ti ${PlatformIcon(Item.Platform)}`}></i>
											{/if}
										</div>
										<div class="Eyebrow">
											<i class={`ti ${PlatformIcon(Item.Platform)}`}></i>{Item.Platform} / {Item.Kind}
											{#if Item.Live}<span class="Tag LiveTag">live</span>{/if}
											{#if Item.Campaign !== 'Organic'}<span class="Tag CampaignTag">{Item.Campaign}</span>{/if}
										</div>
										<h2>{Item.Creator}: {Item.Title}</h2>
										<p>{Item.Metric} / {Item.Age}{Item.Velocity ? ` / ${Item.Velocity} velocity` : ''}</p>
										<div class="ScoreBar"><span style={`width:${Item.Score}%`}></span></div>
										<div class="ScoreLabel">opportunity {Item.Score} / 100</div>
									</button>
									<div class="TriageActions">
										{#each ContentStatusActions as Action}
											<button class:Active={Item.Status === Action.Status} aria-label={Action.Label} onclick={() => UpdateContentStatus(Item, Action.Status)}>
												<i class={`ti ${Action.Icon}`}></i>
											</button>
										{/each}
									</div>
								</div>
							{:else}
								<div class="EmptyState">
									<i class="ti ti-filter-off"></i>
									<span>No sources match the current filters.</span>
								</div>
							{/each}
						</div>

						<div class="FeedList">
							<div class="SectionHead">
								<span>full feed / {FeedItems.length} sources</span>
								<span>{ActiveFeedFilter}</span>
							</div>
							{#each FeedItems as Item, Index}
								<div class="FeedRow">
									<button class="FeedMain" onclick={() => (SelectedCreatorName = Item.Creator)}>
										<span class="RowNum">{Index + 1}</span>
										<span class="RowThumb">
											{#if Item.ThumbnailUrl}
												<img src={Item.ThumbnailUrl} alt="" loading="lazy" />
											{:else}
												<i class={`ti ${PlatformIcon(Item.Platform)}`}></i>
											{/if}
										</span>
										<span class="RowBody">
											<span class="RowCreator">{Item.Platform} / {Item.Creator}</span>
											<span class="RowTitle">{Item.Title}</span>
											<span class="RowMeta">
												{Item.Age} / {Item.Kind} / {Item.Metric}
												<span class="Tag">{Item.Status}</span>
												{#if LatestAction(Item.LastAction, Item.LastActionBy)}<span class="ActionTag">{LatestAction(Item.LastAction, Item.LastActionBy)}</span>{/if}
												{#if Item.Campaign !== 'Organic'}<span class="Tag CampaignTag">{Item.Campaign}</span>{/if}
											</span>
										</span>
										<span class={`RowScore ${ScoreClass(Item.Score)}`}>{Item.Score}</span>
									</button>
									{#if Item.SourceUrl}
										<a class="SourceLink" href={Item.SourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${Item.Title}`}>
											<i class="ti ti-external-link"></i>
										</a>
									{/if}
									<div class="RowTriageActions">
										{#each ContentStatusActions as Action}
											<button class:Active={Item.Status === Action.Status} aria-label={Action.Label} onclick={() => UpdateContentStatus(Item, Action.Status)}>
												<i class={`ti ${Action.Icon}`}></i>
											</button>
										{/each}
									</div>
									<form method="POST" action="?/AddContentToQueue" class="QueueSourceForm" use:enhance={FormFeedback('Queue item')}>
										<input type="hidden" name="ContentId" value={Item.Id} />
										<button aria-label={`Queue ${Item.Title}`}>
											<i class="ti ti-list-plus"></i>
										</button>
									</form>
								</div>
							{:else}
								<div class="EmptyState InlineEmpty">
									<i class="ti ti-filter-off"></i>
									<span>No feed items above score {AppSettings.MinimumScore}. Lower the minimum score or sync more sources.</span>
								</div>
							{/each}
						</div>
					</div>

					<aside class="RightPanel">
						<div class="PanelSection">
							<div class="PanelLabel">Workflow</div>
							<div class="StatGrid">
								<div><span>Clips made</span><strong>{ClippedCount}</strong></div>
								<div><span>Uploads out</span><strong>{UploadedCount}</strong></div>
								<div><span>Avg score</span><strong>{AverageScore}</strong></div>
								<div><span>In queue</span><strong>{QueueState.length}</strong></div>
							</div>
						</div>
						<div class="PanelSection">
							<div class="PanelLabel">Recent activity</div>
							<div class="ActivityList">
								{#each ActivityEvents.slice(0, 6) as Event}
									<div>
										<strong>{Event.Label}</strong>
										<span>{Event.EntityType} / {new Date(Event.CreatedAt).toLocaleString()}</span>
									</div>
								{:else}
									<div><strong>No activity yet</strong><span>Team actions will appear here.</span></div>
								{/each}
							</div>
						</div>
						<div class="PanelSection">
							<div class="PanelLabel">
								Clip queue
								<button onclick={() => (ActiveView = 'Queue')}>view all</button>
							</div>
							{#each QueueState.slice(0, 3) as Task}
								<div class="QueueCard">
									<div class="QueueCreator">{Task.Creator} / {Task.Platform}</div>
									<div class="QueueTitle">{Task.Source}</div>
									<div class="QueueTimestamp">{Task.Timestamp}</div>
									<div class="TaskTargets">
										{#each Object.entries(Task.Targets) as [Target, Done]}
											<span class:Done>{Target}{Done ? ' ok' : ''}</span>
										{/each}
									</div>
								</div>
							{:else}
								<div class="EmptyState MiniEmpty">
									<i class="ti ti-inbox"></i>
									<span>No clips queued.</span>
								</div>
							{/each}
						</div>
						<div class="RevenueBlock">
							<div class="PanelLabel">Campaign earnings</div>
							<div class="Revenue">${Earnings}</div>
							<div class="Muted">{Campaigns.length} active campaigns</div>
							<div class="ScoreBar"><span style={`width:${EarningsGoal ? Math.min(100, (Earnings / EarningsGoal) * 100) : 0}%`}></span></div>
							<div class="GoalLine"><span>${Earnings} earned</span><span>${EarningsGoal} goal</span></div>
						</div>
					</aside>
				</div>
			</section>
		{:else if ActiveView === 'Creators'}
			<section class="View">
				<div class="CreatorHeader">
					<div class="CreatorAvatar">{SelectedCreator.Initial}</div>
					<div class="CreatorMeta">
						<select bind:value={SelectedCreatorName} class="CreatorSelect" aria-label="Creator">
							{#each Creators as Creator}<option>{Creator.Name}</option>{/each}
						</select>
						<div class="CreatorPlatforms">
							{#each SelectedCreator.Platforms as Platform}
								<span><i class={`ti ${PlatformIcon(Platform)}`}></i>{Platform}</span>
							{/each}
							<span>{SelectedCreator.Campaign}</span>
						</div>
					</div>
					<div class="CreatorStats">
						<div><strong>{SelectedCreator.LiveViewers}</strong><span>live viewers</span></div>
						<div><strong>{SelectedCreator.Followers}</strong><span>followers</span></div>
						<div><strong>{SelectedCreator.AverageScore}</strong><span>avg score</span></div>
						<div><strong>{SelectedCreator.ClipsMade}</strong><span>clips made</span></div>
					</div>
					<form method="POST" action="?/DeleteCreator" class="InlineDelete HeaderDelete" use:enhance={FormFeedback('Creator')}>
						<input type="hidden" name="Name" value={SelectedCreator.Name} />
						<button aria-label={`Delete ${SelectedCreator.Name}`}>
							<i class="ti ti-trash"></i>Delete
						</button>
					</form>
				</div>
				<div class="PageScroll">
					<form method="POST" action="?/AddCreator" class="QuickForm" use:enhance={FormFeedback('Creator')}>
						<input name="Name" placeholder="Creator name" required />
						<input name="Platforms" placeholder="Platforms: Kick, Twitch" />
						<input name="Campaign" placeholder="Campaign" />
						<input name="Followers" placeholder="Followers" />
						<button class="PrimaryButton"><i class="ti ti-plus"></i>Add creator</button>
					</form>
					<form method="POST" action="?/UpdateCreator" class="QuickForm CreatorEditForm" use:enhance={FormFeedback('Creator')}>
						<input type="hidden" name="Name" value={SelectedCreator.Name} />
						<input name="Platforms" value={SelectedCreator.Platforms.join(', ')} aria-label="Platforms" />
						<input name="Campaign" value={SelectedCreator.Campaign} aria-label="Campaign" />
						<input name="LiveViewers" value={SelectedCreator.LiveViewers} aria-label="Live viewers" />
						<input name="Followers" value={SelectedCreator.Followers} aria-label="Followers" />
						<input name="AverageScore" type="number" min="0" max="100" value={SelectedCreator.AverageScore} aria-label="Average score" />
						<input name="ClipsMade" type="number" min="0" value={SelectedCreator.ClipsMade} aria-label="Clips made" />
						<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save creator</button>
					</form>
					{#if SelectedCampaign}
						<div class="CreatorRuleSummary">
							<div class="SectionHead"><span>{SelectedCampaign.Name} rules</span><span>{SelectedCampaign.Rate}</span></div>
							<div class="CampaignRules">
								<div><span>Allowed</span><p>{SelectedCampaign.Allowed.join(', ')}</p></div>
								<div><span>Rules</span><p>{SelectedCampaign.Rules || 'No campaign rules saved.'}</p></div>
								<div><span>Hook</span><p>{SelectedCampaign.HookRules || 'No hook guidance saved.'}</p></div>
								<div><span>Banned</span><p>{SelectedCampaign.BannedTerms || 'No banned terms saved.'}</p></div>
							</div>
						</div>
					{/if}
					<div class="SectionHead"><span>Recent content</span></div>
					{#each CreatorItems as Item, Index}
						<div class="FeedRow Static">
							<span class="RowNum">{Index + 1}</span>
							<span class="RowBody">
								<span class="RowCreator">{Item.Platform} / {Item.Kind}</span>
								<span class="RowTitle">{Item.Title}</span>
								<span class="RowMeta">{Item.Age} / {Item.Metric}</span>
							</span>
							<span class={`RowScore ${ScoreClass(Item.Score)}`}>{Item.Score}</span>
						</div>
					{/each}
					<label class="NotesCard">
						<span>Notes, hooks, timestamps</span>
						<textarea
							bind:value={EditableNotes[SelectedCreator.Name]}
							onblur={() => SaveCreatorNotes(SelectedCreator.Name)}
						></textarea>
					</label>
				</div>
			</section>
		{:else if ActiveView === 'Queue'}
			<section class="View">
				<div class="Subheader">
					<span class="SubheaderTitle">Clip queue</span>
					{#each QueueFilters as Filter}
						<button
							class:Active={ActiveQueueFilter === Filter}
							class="Chip"
							onclick={() => (ActiveQueueFilter = Filter)}
						>
							{Filter}
						</button>
					{/each}
					<div class="SubheaderSpacer"></div>
				</div>
				<form method="POST" action="?/AddClipTask" class="QuickForm QueueForm" use:enhance={FormFeedback('Clip')}>
					<select name="Creator" required>
						{#each Creators as Creator}<option>{Creator.Name}</option>{/each}
					</select>
					<select name="Platform">
						<option>Kick</option><option>Twitch</option><option>YouTube</option><option>TikTok</option>
					</select>
					<input name="Source" placeholder="Source moment" required />
					<input name="SourceUrl" placeholder="Source URL" />
					<input name="Timestamp" placeholder="1:24:33" />
					<input name="Hook" placeholder="Hook idea" />
					<input name="Score" type="number" min="0" max="100" placeholder="Score" />
					<label><input name="TikTok" type="checkbox" checked />TT</label>
					<label><input name="Shorts" type="checkbox" />YT</label>
					<label><input name="Reels" type="checkbox" />IG</label>
					<input name="TikTokUrl" placeholder="TikTok URL" />
					<input name="ShortsUrl" placeholder="Shorts URL" />
					<input name="ReelsUrl" placeholder="Reels URL" />
					<button class="PrimaryButton"><i class="ti ti-plus"></i>Add clip</button>
				</form>
				<div class="TableWrap">
					<table>
						<thead>
							<tr>
								<th>#</th>
								<th>Source</th>
								<th>Timestamp</th>
								<th>Hook idea</th>
								<th>Platforms</th>
								<th>Score</th>
								<th>Status</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each QueueItems as Task}
								<tr>
									<td>{Task.Id}</td>
									<td>
										<div class="QueueCreator">{Task.Creator} / {Task.Platform}</div>
										<div>{Task.Source}</div>
										{#if Task.SourceUrl}
											<a class="QueueSourceLink" href={Task.SourceUrl} target="_blank" rel="noreferrer">open source</a>
										{/if}
										{#if LatestAction(Task.LastAction, Task.LastActionBy)}
											<div class="ActionLine">{LatestAction(Task.LastAction, Task.LastActionBy)}</div>
										{/if}
									</td>
									<td class="QueueTimestamp">{Task.Timestamp}</td>
									<td class="Hook">"{Task.Hook}"</td>
									<td>
										<div class="TaskTargets">
											{#each Object.entries(Task.Targets) as [Target, Done]}
												{#if UploadUrl(Task, Target)}
													<a href={UploadUrl(Task, Target)} target="_blank" rel="noreferrer">{Target}</a>
												{:else}
													<span class:Done>{Target}</span>
												{/if}
											{/each}
										</div>
									</td>
									<td><span class={`RowScore ${ScoreClass(Task.Score)}`}>{Task.Score}</span></td>
									<td>
										<select value={Task.Status} onchange={(Event) => UpdateTaskStatus(Task, Event.currentTarget.value)}>
											{#each QueueFilters.filter((Filter) => Filter !== 'All') as Status}
												<option>{Status}</option>
											{/each}
											<option>Uploading</option>
											<option>Watched</option>
											<option>To clip</option>
										</select>
									</td>
									<td>
										<div class="RowActions">
											<button aria-label={`Edit clip task ${Task.Id}`} onclick={() => (EditingTaskId = EditingTaskId === Task.Id ? null : Task.Id)}>
												<i class="ti ti-edit"></i>
											</button>
											<form method="POST" action="?/DeleteClipTask" class="InlineDelete TableDelete" use:enhance={FormFeedback('Clip')}>
												<input type="hidden" name="Id" value={Task.Id} />
												<button aria-label={`Delete clip task ${Task.Id}`}><i class="ti ti-trash"></i></button>
											</form>
										</div>
									</td>
								</tr>
								{#if EditingTaskId === Task.Id}
									<tr class="EditRow">
										<td></td>
										<td colspan="7">
											<form method="POST" action="?/UpdateClipTask" class="InlineEditForm" use:enhance={FormFeedback('Clip')}>
											<input type="hidden" name="Id" value={Task.Id} />
											<input name="Source" value={Task.Source} aria-label="Source" />
											<input name="SourceUrl" value={Task.SourceUrl ?? ''} aria-label="Source URL" />
											<input name="Timestamp" value={Task.Timestamp} aria-label="Timestamp" />
											<input name="Hook" value={Task.Hook} aria-label="Hook" />
											<input name="Score" type="number" min="0" max="100" value={Task.Score} aria-label="Score" />
											<select name="Status" value={Task.Status} aria-label="Status">
												<option>To upload</option><option>Editing</option><option>Done</option><option>Uploading</option><option>Watched</option><option>To clip</option>
											</select>
											<label><input name="TikTok" type="checkbox" checked={Task.Targets.TikTok} />TT</label>
											<label><input name="Shorts" type="checkbox" checked={Task.Targets.Shorts} />YT</label>
											<label><input name="Reels" type="checkbox" checked={Task.Targets.Reels} />IG</label>
											<input name="TikTokUrl" value={Task.UploadUrls.TikTok} aria-label="TikTok upload URL" />
											<input name="ShortsUrl" value={Task.UploadUrls.Shorts} aria-label="Shorts upload URL" />
											<input name="ReelsUrl" value={Task.UploadUrls.Reels} aria-label="Reels upload URL" />
											<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save</button>
											</form>
										</td>
									</tr>
								{/if}
							{:else}
								<tr>
									<td colspan="8">
										<div class="EmptyState InlineEmpty">
											<i class="ti ti-inbox"></i>
											<span>No queue items match this filter.</span>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{:else if ActiveView === 'Campaigns'}
			<section class="View PageScroll">
				<div class="PageTitleRow">
					<div>
						<h1>Campaigns</h1>
						<p>Active clipping agreements and payout tracking.</p>
					</div>
				</div>
				<form method="POST" action="?/AddCampaign" class="QuickForm" use:enhance={FormFeedback('Campaign')}>
					<input name="Name" placeholder="Campaign name" required />
					<input name="Rate" placeholder="$4 / 1k views" />
					<input name="Niche" placeholder="Niche" />
					<input name="Goal" type="number" min="1" placeholder="Goal" />
					<input name="Allowed" placeholder="TikTok, YouTube Shorts, Instagram Reels" />
					<input name="Rules" placeholder="Campaign rules" />
					<input name="HookRules" placeholder="Hook rules" />
					<input name="BannedTerms" placeholder="Banned terms" />
					<button class="PrimaryButton"><i class="ti ti-plus"></i>Add campaign</button>
				</form>
				<div class="CampaignGrid">
					{#each Campaigns as Campaign}
						<div class="CampaignCard">
							<div class="CampaignTop">
								<div>
									<h2>{Campaign.Name}</h2>
									<p>{Campaign.State}</p>
								</div>
								<strong>${Campaign.Earned}<span> earned</span></strong>
							</div>
							<div class="CampaignDetails">
								<div><span>Rate</span><b>{Campaign.Rate}</b></div>
								<div><span>Submitted</span><b>{Campaign.Submitted}</b></div>
								<div><span>Niche</span><b>{Campaign.Niche}</b></div>
							</div>
							<div class="ScoreBar"><span style={`width:${(Campaign.Earned / Campaign.Goal) * 100}%`}></span></div>
							<div class="GoalLine"><span>${Campaign.Earned} / ${Campaign.Goal}</span><span>{Math.round((Campaign.Earned / Campaign.Goal) * 100)}%</span></div>
							<div class="Allowed">
								{#each Campaign.Allowed as Platform}<span>{Platform}</span>{/each}
							</div>
							<div class="CampaignRules">
								<div><span>Rules</span><p>{Campaign.Rules || 'No campaign rules saved.'}</p></div>
								<div><span>Hook</span><p>{Campaign.HookRules || 'No hook guidance saved.'}</p></div>
								<div><span>Banned</span><p>{Campaign.BannedTerms || 'No banned terms saved.'}</p></div>
							</div>
							<form method="POST" action="?/UpdateCampaign" class="CampaignEditForm" use:enhance={FormFeedback('Campaign')}>
								<input type="hidden" name="Name" value={Campaign.Name} />
								<input name="State" value={Campaign.State} aria-label="State" />
								<input name="Rate" value={Campaign.Rate} aria-label="Rate" />
								<input name="Niche" value={Campaign.Niche} aria-label="Niche" />
								<input name="Earned" type="number" min="0" value={Campaign.Earned} aria-label="Earned" />
								<input name="Goal" type="number" min="1" value={Campaign.Goal} aria-label="Goal" />
								<input name="Submitted" type="number" min="0" value={Campaign.Submitted} aria-label="Submitted" />
								<input name="Allowed" value={Campaign.Allowed.join(', ')} aria-label="Allowed platforms" />
								<input name="Rules" value={Campaign.Rules} aria-label="Rules" />
								<input name="HookRules" value={Campaign.HookRules} aria-label="Hook rules" />
								<input name="BannedTerms" value={Campaign.BannedTerms} aria-label="Banned terms" />
								<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save</button>
							</form>
							<form method="POST" action="?/DeleteCampaign" class="InlineDelete" use:enhance={FormFeedback('Campaign')}>
								<input type="hidden" name="Name" value={Campaign.Name} />
								<button aria-label={`Delete ${Campaign.Name}`}>
									<i class="ti ti-trash"></i>Delete
								</button>
							</form>
						</div>
					{/each}
				</div>
				<div class="MetricBand">
					<div><span>Earned</span><strong>${Earnings}</strong></div>
					<div><span>This month</span><strong>${Earnings}</strong></div>
					<div><span>Total clips</span><strong>{ClippedCount}</strong></div>
					<div><span>Total uploads</span><strong>{UploadedCount}</strong></div>
				</div>
			</section>
		{:else}
			<section class="View PageScroll">
				<div class="PageTitleRow">
					<div>
						<h1>Connected accounts</h1>
						<p>Link clipping accounts for upload tracking, and source accounts for fresh content.</p>
					</div>
				</div>
				<div class="SectionHead"><span>Your clipping platforms</span></div>
				<div class="AccountGrid">
					{#each UploadPlatformStats as Stat}
						<div class="AccountCard">
							<div class="AccountTop">
								<div class="AccountIcon"><i class={`ti ${PlatformIcon(Stat.Platform)}`}></i></div>
								<div><h2>{Stat.Platform}</h2><p>{Stat.Queued} queued targets</p></div>
							</div>
							<div class="AccountStats">
								<div><strong>{Stat.Uploads}</strong><span>uploads</span></div>
								<div><strong>{Stat.Queued}</strong><span>planned</span></div>
								<div><strong>{QueueState.length ? Math.round((Stat.Uploads / QueueState.length) * 100) : 0}%</strong><span>coverage</span></div>
							</div>
							<span class={Stat.Uploads ? 'ConnectedText' : 'Chip'}>{Stat.Uploads ? 'Tracking' : 'No uploads yet'}</span>
						</div>
					{/each}
				</div>
				<div class="SectionHead"><span>Source platforms</span></div>
				<div class="SourceActionRow">
					<span>{SourceAccounts.length} / {PlatformAccounts.length} saved source accounts</span>
					<div>
						<label class="SourceSearch">
							<i class="ti ti-search"></i>
							<input bind:value={SourceSearch} placeholder="Find source account" aria-label="Find source account" />
						</label>
						<a class="PrimaryButton" href="/api/backup/db" download><i class="ti ti-download"></i>Backup DB</a>
						<form method="POST" action="?/ImportDatabaseBackup" enctype="multipart/form-data" class="ImportBackupForm" use:enhance={FormFeedback('Database import')}>
							<label class="PrimaryButton">
								<i class="ti ti-upload"></i>Import DB
								<input name="Backup" type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" onchange={(Event) => Event.currentTarget.form?.requestSubmit()} />
							</label>
						</form>
						<button class="PrimaryButton" disabled={IsResolvingSources} onclick={ResolveSources}>
							<i class="ti ti-id"></i>{IsResolvingSources ? 'Resolving IDs' : 'Resolve source IDs'}
						</button>
					</div>
				</div>
				<div class="ApiKeyPanel">
					<div>
						<h2>API keys</h2>
						<p>Keys are stored locally in SQLite. Environment variables still override saved values.</p>
					</div>
					<form method="POST" action="?/SaveApiCredentials" class="ApiKeyForm" use:enhance={FormFeedback('API keys')}>
						{#each ApiCredentials as Credential}
							<label>
								<span>{Credential.Label}</span>
								<input name={Credential.Key} type="password" placeholder={Credential.Configured ? `Saved / ${Credential.Source} / ...${Credential.LastFour}` : 'Not set'} autocomplete="off" />
							</label>
						{/each}
						<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save keys</button>
					</form>
					<div class="CredentialList">
						{#each ApiCredentials as Credential}
							<div>
								<span>{Credential.Label}</span>
								<strong class:Configured={Credential.Configured}>{Credential.Configured ? `${Credential.Source} / ...${Credential.LastFour}` : 'Missing'}</strong>
								<form method="POST" action="?/ClearApiCredential" use:enhance={FormFeedback('API key')}>
									<input type="hidden" name="Key" value={Credential.Key} />
									<button disabled={Credential.Source === 'Environment' || !Credential.Configured} aria-label={`Clear ${Credential.Label}`}>
										<i class="ti ti-trash"></i>
									</button>
								</form>
							</div>
						{/each}
					</div>
				</div>
				<form method="POST" action="?/AddSourceAccount" class="QuickForm SourceAccountForm" use:enhance={FormFeedback('Source account')}>
					<input name="Creator" placeholder="Creator name" required />
					<select name="Platform" required>
						<option>YouTube</option>
						<option>Twitch</option>
						<option>Kick</option>
						<option>TikTok</option>
						<option>Instagram</option>
						<option>X</option>
					</select>
					<input name="Handle" placeholder="@handle" required />
					<input name="ExternalId" placeholder="Channel/user id or manual key" required />
					<input name="SourceUrl" placeholder="Source URL optional" />
					<button class="PrimaryButton"><i class="ti ti-plus"></i>Add source</button>
				</form>
				<div class="SourceGroupList">
					{#each SourceGroups as Group}
						<section class="SourceGroup">
							<div class="SectionHead"><span>{Group.Platform}</span><span>{Group.Accounts.length} accounts</span></div>
							<div class="AccountGrid">
								{#each Group.Accounts as Account}
									<div class="AccountCard">
										<div class="AccountTop">
											<div class="AccountIcon"><i class={`ti ${PlatformIcon(Account.Platform)}`}></i></div>
											<div><h2>{Account.Creator}</h2><p>{Account.Platform} / {Account.Handle}</p></div>
										</div>
										<p class="Muted">
											{Account.LastError ?? (Account.LastSyncedAt ? `Last synced ${Account.LastSyncedAt}` : 'Ready for manual sync')}
										</p>
										<div class="SourceIdLine">
											<span>ID</span>
											<code>{Account.ExternalId}</code>
										</div>
										<form method="POST" action="?/UpdateSourceAccount" class="SourceAccountEditForm" use:enhance={FormFeedback('Source account')}>
											<input type="hidden" name="Id" value={Account.Id} />
											<input name="Creator" value={Account.Creator} aria-label="Creator" />
											<select name="Platform" value={Account.Platform} aria-label="Platform">
												<option>YouTube</option>
												<option>Twitch</option>
												<option>Kick</option>
												<option>TikTok</option>
												<option>Instagram</option>
												<option>X</option>
											</select>
											<input name="Handle" value={Account.Handle} aria-label="Handle" />
											<input name="ExternalId" value={Account.ExternalId} aria-label="External ID" />
											<input name="SourceUrl" value={Account.SourceUrl ?? ''} aria-label="Source URL" />
											<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save</button>
										</form>
										{#if Account.Platform === 'YouTube'}
											<button class="PrimaryButton" disabled={IsSyncingYoutube} onclick={SyncYoutube}>
												<i class="ti ti-refresh"></i>{IsSyncingYoutube ? 'Syncing' : 'Sync YouTube'}
											</button>
										{:else if Account.Platform === 'Twitch'}
											<button class="PrimaryButton" disabled={IsSyncingTwitch} onclick={SyncTwitch}>
												<i class="ti ti-refresh"></i>{IsSyncingTwitch ? 'Syncing' : 'Sync Twitch'}
											</button>
										{:else if Account.Platform === 'Kick'}
											<button class="PrimaryButton" disabled={IsSyncingKick} onclick={SyncKick}>
												<i class="ti ti-refresh"></i>{IsSyncingKick ? 'Syncing' : 'Sync Kick'}
											</button>
										{:else}
											<span class={Account.Connected ? 'ConnectedText' : 'Chip'}>{Account.Connected ? 'Connected' : 'Manual'}</span>
										{/if}
										<form method="POST" action="?/DeleteSourceAccount" class="InlineDelete" use:enhance={FormFeedback('Source account')}>
											<input type="hidden" name="Id" value={Account.Id} />
											<button aria-label={`Remove ${Account.Creator} ${Account.Platform}`}>
												<i class="ti ti-trash"></i>Remove
											</button>
										</form>
									</div>
								{/each}
							</div>
						</section>
					{:else}
						<div class="EmptyState">
							<i class="ti ti-search-off"></i>
							<span>No source accounts match this search.</span>
						</div>
					{/each}
				</div>
				<div class="SectionHead"><span>Sync history</span></div>
				<div class="SyncList">
					{#each SyncRuns.slice(-5).reverse() as Run}
						<div>
							<strong>{Run.Platform} / {Run.Status}</strong>
							<span>{Run.ItemsFound} items / {Run.Message ?? 'No message'}</span>
						</div>
					{:else}
						<div><strong>No sync runs yet</strong><span>Add keys in API settings, then run sync all.</span></div>
					{/each}
				</div>
				<form method="POST" action="?/SaveAppSettings" class="PreferenceGrid" use:enhance={FormFeedback('Preferences')}>
					<label>
						<span>Niche keywords</span>
						<input name="NicheKeywords" value={AppSettings.NicheKeywords} />
					</label>
					<label>
						<span>Refresh schedule</span>
						<select name="RefreshSchedule" value={AppSettings.RefreshSchedule}>
							<option value="15">Every 15 minutes</option>
							<option value="30">Every 30 minutes</option>
							<option value="60">Every hour</option>
							<option value="180">Every 3 hours</option>
						</select>
					</label>
					<label>
						<span>Minimum opportunity score</span>
						<input name="MinimumScore" type="number" min="0" max="100" value={AppSettings.MinimumScore} />
					</label>
					{#each ScoreWeights as Weight}
						<label>
							<span>{Weight.Label} weight</span>
							<input name={Weight.Key} type="number" min="0" max="3" step="0.1" value={Weight.Value} />
						</label>
					{/each}
					<button class="PrimaryButton"><i class="ti ti-device-floppy"></i>Save preferences</button>
				</form>
			</section>
		{/if}
	</main>
</div>

{#if NeedsActor}
	<div class="ActorOverlay">
		<form class="ActorPrompt" onsubmit={(Event) => { Event.preventDefault(); SaveActor(); }}>
			<div>
				<span class="PanelLabel">Team identity</span>
				<h2>Who is using Vantage?</h2>
				<p>This name stays in this browser and labels your team actions.</p>
			</div>
			<input bind:value={ActorDraft} placeholder="Your name" maxlength="40" />
			<div class="ActorPromptActions">
				{#if ActorName}<button type="button" class="Chip" onclick={() => (NeedsActor = false)}>Cancel</button>{/if}
				<button class="PrimaryButton" disabled={!ActorDraft.trim()}><i class="ti ti-check"></i>Continue</button>
			</div>
		</form>
	</div>
{/if}

<div class="ToastStack" aria-live="polite">
	{#each Toasts as Toast}
		<div class={`Toast ${Toast.Kind}`}>{Toast.Message}</div>
	{/each}
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html),
	:global(body) {
		margin: 0;
		height: 100%;
	}

	:global(body) {
		--Page: #f7f5f0;
		--Surface: #eceae4;
		--Ink: #1a1916;
		--Ink2: #6a6862;
		--Ink3: #a8a59e;
		--Rule: #d8d5ce;
		--RuleSoft: #e8e5de;
		--Green: #2b5c3a;
		--GreenSoft: #eaf1ec;
		--Amber: #92520a;
		--AmberSoft: #faf2e8;
		--Blue: #1a3e6e;
		--BlueSoft: #eaf0fa;
		background: var(--Page);
		color: var(--Ink);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		overflow: hidden;
	}

	button,
	input,
	select,
	textarea {
		font: inherit;
	}

	button {
		color: inherit;
		cursor: pointer;
	}

	.Topnav {
		align-items: center;
		background: var(--Ink);
		display: flex;
		gap: 2px;
		height: 48px;
		padding: 0 20px;
	}

	.Wordmark {
		background: transparent;
		border: 0;
		color: var(--Page);
		font-family: 'Fraunces', serif;
		font-size: 19px;
		margin-right: 22px;
	}

	.Wordmark em {
		color: #8dbf9e;
	}

	.NavLink {
		align-items: center;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: #7a7870;
		display: flex;
		gap: 7px;
		height: 48px;
		padding: 0 13px;
	}

	.NavLink.Active {
		border-bottom-color: #8dbf9e;
		color: var(--Page);
	}

	.Count,
	.SidebarCount {
		background: #373530;
		border-radius: 10px;
		color: #b8b5ad;
		font-size: 10px;
		padding: 1px 6px;
	}

	.NavSpacer,
	.SubheaderSpacer {
		flex: 1;
	}

	.RefreshTag {
		color: #7a7870;
		font-size: 11px;
	}

	.SyncButton {
		align-items: center;
		background: #2b2925;
		border: 1px solid #3f3c36;
		border-radius: 14px;
		color: #b8b5ad;
		display: inline-flex;
		font-size: 11px;
		gap: 5px;
		padding: 4px 9px;
	}

	.SyncButton:disabled {
		cursor: wait;
		opacity: 0.65;
	}

	.ActorPill {
		align-items: center;
		background: #332f28;
		border: 1px solid #4a453b;
		border-radius: 14px;
		color: #d9d3c8;
		display: inline-flex;
		font-size: 11px;
		gap: 5px;
		padding: 4px 9px;
	}

	.LiveDot {
		background: rgba(141, 191, 158, 0.14);
		border-radius: 14px;
		color: #8dbf9e;
		font-size: 11px;
		padding: 4px 9px;
	}

	.Avatar {
		align-items: center;
		background: #3a3832;
		border-radius: 50%;
		color: var(--Page);
		display: grid;
		font-size: 10px;
		height: 28px;
		place-items: center;
		width: 28px;
	}

	.Shell {
		display: flex;
		height: calc(100vh - 48px);
	}

	.Sidebar {
		background: var(--Surface);
		border-right: 1px solid var(--Rule);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		padding: 18px 12px;
		width: 220px;
	}

	.SidebarLabel,
	.SectionHead,
	.PanelLabel {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.SidebarItem {
		align-items: center;
		background: transparent;
		border: 0;
		border-radius: 6px;
		display: flex;
		justify-content: space-between;
		margin-top: 3px;
		padding: 8px 9px;
		text-align: left;
		width: 100%;
	}

	.SidebarItem span:first-child {
		align-items: center;
		display: flex;
		gap: 9px;
	}

	.SidebarItem.Active,
	.SidebarItem:hover {
		background: var(--Page);
	}

	.SidebarCount.Live {
		background: var(--Green);
		color: white;
	}

	.SidebarDivider {
		border-top: 1px solid var(--Rule);
		margin: 14px 0;
	}

	.SidebarBottom {
		margin-top: auto;
	}

	.Main,
	.View {
		display: flex;
		flex: 1;
		min-width: 0;
	}

	.View {
		flex-direction: column;
	}

	.ConnectBanner,
	.Subheader {
		align-items: center;
		border-bottom: 1px solid var(--Rule);
		display: flex;
		gap: 10px;
	}

	.ConnectBanner {
		background: var(--GreenSoft);
		color: var(--Green);
		font-size: 12px;
		padding: 9px 22px;
	}

	.ConnectBanner button,
	.PanelLabel button {
		background: transparent;
		border: 0;
		color: var(--Green);
		font-size: 12px;
		margin-left: auto;
	}

	.Subheader {
		background: var(--Surface);
		padding: 12px 22px;
	}

	.SubheaderTitle {
		font-family: 'Fraunces', serif;
		font-size: 18px;
		margin-right: 8px;
	}

	.Chip,
	.Subheader select,
	table select,
	.PrimaryButton,
	.ConnectedText {
		border: 1px solid var(--Rule);
		border-radius: 6px;
		padding: 5px 10px;
	}

	.Chip {
		background: var(--Page);
		color: var(--Ink2);
	}

	.Chip.Active {
		background: var(--Ink);
		border-color: var(--Ink);
		color: var(--Page);
	}

	select,
	input,
	textarea {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink);
		padding: 6px 9px;
	}

	.SearchWrap {
		align-items: center;
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		display: flex;
		gap: 6px;
		min-width: 260px;
		padding: 0 8px;
	}

	.SearchWrap input {
		background: transparent;
		border: 0;
		flex: 1;
		min-width: 0;
		padding: 6px 0;
	}

	.SearchWrap button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		display: grid;
		padding: 0;
		place-items: center;
	}

	.SaveSearchForm button {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		display: grid;
		height: 30px;
		place-items: center;
		width: 34px;
	}

	.SaveSearchForm button:disabled {
		opacity: 0.45;
	}

	.SavedSearchRow {
		align-items: center;
		background: var(--Surface);
		border-bottom: 1px solid var(--Rule);
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		padding: 8px 22px;
	}

	.SavedSearchRow span {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.12em;
		margin-right: 4px;
		text-transform: uppercase;
	}

	.SavedSearchRow form {
		display: contents;
	}

	.SavedSearchRow button {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		font-size: 11px;
		padding: 4px 8px;
	}

	.SavedSearchRow button.Active {
		background: var(--Ink);
		border-color: var(--Ink);
		color: var(--Page);
	}

	.ContentPanes {
		display: grid;
		flex: 1;
		grid-template-columns: minmax(0, 1fr) 320px;
		min-height: 0;
	}

	.Feed,
	.PageScroll,
	.TableWrap {
		overflow-y: auto;
		padding: 22px;
	}

	.LeadGrid {
		display: grid;
		gap: 12px;
		grid-template-columns: 1.15fr 1fr 1fr;
		margin-bottom: 18px;
	}

	.LeadCell,
	.CampaignCard,
	.AccountCard,
	.NotesCard,
	.QueueCard,
	.MetricBand > div,
	.PreferenceGrid label {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 8px;
	}

	.LeadCell {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		text-align: left;
	}

	.LeadMain {
		background: transparent;
		border: 0;
		display: block;
		flex: 1;
		padding: 18px;
		text-align: left;
		width: 100%;
	}

	.LeadMedia {
		align-items: center;
		aspect-ratio: 16 / 9;
		background: var(--RuleSoft);
		border-radius: 7px;
		color: var(--Ink3);
		display: flex;
		font-size: 34px;
		justify-content: center;
		margin: -6px -6px 14px;
		overflow: hidden;
	}

	.LeadMedia img,
	.RowThumb img {
		height: 100%;
		object-fit: cover;
		width: 100%;
	}

	.LeadCell:hover,
	.FeedRow:hover,
	.QueueCard:hover {
		border-color: var(--Ink3);
	}

	.Eyebrow,
	.RowCreator,
	.QueueCreator {
		color: var(--Ink3);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.Eyebrow {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	.LeadCell h2 {
		font-family: 'Fraunces', serif;
		font-size: 23px;
		font-weight: 400;
		line-height: 1.1;
		margin-bottom: 10px;
	}

	.LeadCell p,
	.RowMeta,
	.Muted,
	.PageTitleRow p {
		color: var(--Ink2);
		font-size: 12px;
	}

	.ScoreBar {
		background: var(--RuleSoft);
		border-radius: 3px;
		height: 5px;
		margin-top: 13px;
		overflow: hidden;
	}

	.ScoreBar span {
		background: var(--Green);
		display: block;
		height: 100%;
	}

	.ScoreLabel,
	.GoalLine {
		color: var(--Ink3);
		display: flex;
		font-size: 10px;
		justify-content: space-between;
		margin-top: 6px;
		text-transform: uppercase;
	}

	.FeedList,
	.PanelSection,
	.RevenueBlock {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
	}

	.SectionHead {
		align-items: center;
		display: flex;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.FeedList .SectionHead {
		border-bottom: 1px solid var(--Rule);
		margin: 0;
		padding: 13px 18px;
	}

	.FeedRow {
		align-items: flex-start;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--RuleSoft);
		display: flex;
		width: 100%;
	}

	.FeedMain {
		align-items: flex-start;
		background: transparent;
		border: 0;
		display: flex;
		flex: 1;
		gap: 12px;
		min-width: 0;
		padding: 12px 18px;
		text-align: left;
	}

	.RowThumb {
		align-items: center;
		aspect-ratio: 16 / 9;
		background: var(--RuleSoft);
		border-radius: 6px;
		color: var(--Ink3);
		display: flex;
		flex: 0 0 96px;
		font-size: 22px;
		justify-content: center;
		overflow: hidden;
	}

	.SourceLink {
		align-items: center;
		align-self: stretch;
		border-left: 1px solid var(--RuleSoft);
		color: var(--Ink3);
		display: flex;
		justify-content: center;
		min-width: 42px;
		text-decoration: none;
	}

	.RowTriageActions {
		align-self: stretch;
		border-left: 1px solid var(--RuleSoft);
		display: flex;
	}

	.TriageActions {
		border-top: 1px solid var(--RuleSoft);
		display: grid;
		grid-template-columns: repeat(3, 1fr);
	}

	.TriageActions button,
	.RowTriageActions button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		display: grid;
		place-items: center;
	}

	.TriageActions button {
		min-height: 38px;
	}

	.RowTriageActions button {
		min-width: 34px;
	}

	.TriageActions button + button,
	.RowTriageActions button + button {
		border-left: 1px solid var(--RuleSoft);
	}

	.TriageActions button:hover,
	.RowTriageActions button:hover,
	.TriageActions button.Active,
	.RowTriageActions button.Active {
		background: var(--Page);
		color: var(--Green);
	}

	.QueueSourceForm {
		align-self: stretch;
		display: flex;
	}

	.QueueSourceForm button {
		background: transparent;
		border: 0;
		border-left: 1px solid var(--RuleSoft);
		color: var(--Ink3);
		min-width: 42px;
	}

	.SourceLink:hover,
	.QueueSourceForm button:hover {
		background: var(--Page);
		color: var(--Ink);
	}

	.QueueSourceLink {
		color: var(--Green);
		display: inline-block;
		font-size: 11px;
		margin-top: 4px;
		text-decoration: none;
	}

	.SourceIdLine {
		align-items: center;
		background: var(--RuleSoft);
		border-radius: 6px;
		display: flex;
		gap: 8px;
		margin: 10px 0;
		padding: 7px 9px;
	}

	.SourceIdLine span {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.SourceIdLine code {
		color: var(--Ink2);
		font-family: 'DM Sans', sans-serif;
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.SourceAccountEditForm {
		display: grid;
		gap: 7px;
		margin: 10px 0 12px;
	}

	.SourceAccountEditForm input,
	.SourceAccountEditForm select {
		min-width: 0;
		width: 100%;
	}

	.SourceAccountEditForm button {
		justify-content: center;
	}

	.ActorOverlay {
		align-items: center;
		background: rgba(26, 25, 22, 0.42);
		display: grid;
		inset: 0;
		place-items: center;
		position: fixed;
		z-index: 30;
	}

	.ActorPrompt {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		box-shadow: 0 24px 70px rgba(26, 25, 22, 0.28);
		display: grid;
		gap: 14px;
		padding: 18px;
		width: min(380px, calc(100vw - 32px));
	}

	.ActorPrompt h2 {
		font-family: 'Fraunces', serif;
		font-size: 24px;
		font-weight: 400;
		margin-top: 5px;
	}

	.ActorPrompt p {
		color: var(--Ink2);
		font-size: 12px;
		margin-top: 5px;
	}

	.ActorPromptActions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	.ToastStack {
		display: grid;
		gap: 8px;
		position: fixed;
		right: 18px;
		top: 62px;
		width: min(320px, calc(100vw - 36px));
		z-index: 20;
	}

	.Toast {
		background: var(--Ink);
		border: 1px solid #3f3c36;
		border-radius: 8px;
		box-shadow: 0 12px 30px rgba(26, 25, 22, 0.18);
		color: var(--Page);
		font-weight: 600;
		padding: 10px 12px;
	}

	.Toast.Success {
		border-color: #8dbf9e;
	}

	.Toast.Error {
		border-color: #d88989;
	}

	.Toast.Info {
		border-color: #8aa5cf;
	}

	.FeedRow.Static {
		background: var(--Page);
		border: 1px solid var(--RuleSoft);
		border-radius: 8px;
		gap: 12px;
		margin-bottom: 8px;
		padding: 12px 18px;
	}

	.RowNum,
	.QueueTimestamp {
		color: var(--Ink3);
		font-family: 'Fraunces', serif;
		font-style: italic;
	}

	.RowNum {
		font-size: 21px;
		width: 24px;
	}

	.RowBody {
		display: grid;
		flex: 1;
		gap: 4px;
		min-width: 0;
	}

	.RowTitle {
		font-size: 14px;
	}

	.RowScore {
		align-items: center;
		background: var(--RuleSoft);
		border-radius: 50%;
		display: grid;
		font-family: 'Fraunces', serif;
		height: 34px;
		place-items: center;
		width: 34px;
	}

	.RowScore.High {
		background: var(--Green);
		color: white;
	}

	.RowScore.Medium {
		background: var(--AmberSoft);
		color: var(--Amber);
	}

	.Tag,
	.ActionTag,
	.Allowed span,
	.TaskTargets span,
	.CreatorPlatforms span {
		background: var(--RuleSoft);
		border-radius: 4px;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 10px;
		margin-left: 5px;
		padding: 2px 6px;
		text-transform: uppercase;
	}

	.LiveTag {
		background: var(--Green);
		color: white;
	}

	.CampaignTag {
		background: var(--BlueSoft);
		color: var(--Blue);
	}

	.ActionTag {
		background: var(--GreenSoft);
		color: var(--Green);
	}

	.RightPanel {
		background: var(--Surface);
		border-left: 1px solid var(--Rule);
		overflow-y: auto;
		padding: 18px;
	}

	.PanelSection,
	.RevenueBlock {
		margin-bottom: 14px;
		padding: 15px;
	}

	.ActivityList {
		display: grid;
		gap: 9px;
		margin-top: 12px;
	}

	.ActivityList div {
		border-top: 1px solid var(--RuleSoft);
		display: grid;
		gap: 3px;
		padding-top: 9px;
	}

	.ActivityList strong {
		font-size: 12px;
	}

	.ActivityList span,
	.ActionLine {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.ActionLine {
		margin-top: 5px;
	}

	.StatGrid,
	.CampaignDetails,
	.AccountStats,
	.MetricBand {
		display: grid;
		gap: 10px;
	}

	.StatGrid {
		grid-template-columns: 1fr 1fr;
		margin-top: 12px;
	}

	.StatGrid div,
	.CampaignDetails div {
		border-top: 1px solid var(--RuleSoft);
		padding-top: 9px;
	}

	.StatGrid span,
	.CampaignDetails span,
	.AccountStats span,
	.MetricBand span,
	.PreferenceGrid span {
		color: var(--Ink3);
		display: block;
		font-size: 10px;
		text-transform: uppercase;
	}

	.StatGrid strong,
	.Revenue,
	.MetricBand strong {
		font-family: 'Fraunces', serif;
		font-size: 24px;
		font-weight: 400;
	}

	.QueueCard {
		margin-top: 10px;
		padding: 12px;
	}

	.QueueTitle {
		margin: 4px 0;
	}

	.TaskTargets {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 8px;
	}

	.TaskTargets span {
		margin: 0;
	}

	.TaskTargets span.Done {
		background: var(--GreenSoft);
		color: var(--Green);
	}

	.TaskTargets a {
		background: var(--BlueSoft);
		border-radius: 4px;
		color: var(--Blue);
		display: inline-flex;
		font-size: 10px;
		margin: 0;
		padding: 2px 6px;
		text-decoration: none;
		text-transform: uppercase;
	}

	.CreatorHeader {
		align-items: center;
		background: var(--Surface);
		border-bottom: 1px solid var(--Rule);
		display: flex;
		gap: 16px;
		padding: 24px 40px;
	}

	.CreatorAvatar {
		background: var(--Ink);
		border-radius: 12px;
		color: var(--Page);
		display: grid;
		font-family: 'Fraunces', serif;
		font-size: 24px;
		height: 54px;
		place-items: center;
		width: 54px;
	}

	.CreatorMeta {
		flex: 1;
	}

	.CreatorSelect {
		border: 0;
		font-family: 'Fraunces', serif;
		font-size: 24px;
		padding-left: 0;
	}

	.CreatorPlatforms {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}

	.CreatorStats {
		display: flex;
		gap: 22px;
	}

	.CreatorStats strong {
		display: block;
		font-family: 'Fraunces', serif;
		font-size: 20px;
	}

	.CreatorStats span {
		color: var(--Ink3);
		font-size: 10px;
		text-transform: uppercase;
	}

	.NotesCard {
		display: grid;
		gap: 10px;
		margin-top: 18px;
		padding: 16px;
	}

	.CreatorRuleSummary,
	.SourceGroup {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		margin-bottom: 18px;
		padding: 14px;
	}

	.SourceGroupList {
		display: grid;
		gap: 18px;
	}

	.QuickForm {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
		margin-bottom: 18px;
		padding: 12px;
	}

	.QuickForm.QueueForm {
		border-bottom: 1px solid var(--Rule);
		border-left: 0;
		border-radius: 0;
		border-right: 0;
		grid-template-columns: 140px 110px minmax(180px, 1.2fr) minmax(160px, 1fr) 90px minmax(160px, 1fr) 76px repeat(3, auto) repeat(3, minmax(130px, 1fr)) auto;
		margin: 0;
	}

	.QuickForm.SourceAccountForm {
		grid-template-columns: 1fr 120px 150px minmax(180px, 1fr) minmax(180px, 1fr) auto;
	}

	.QuickForm.CreatorEditForm {
		grid-template-columns: repeat(6, minmax(0, 1fr)) auto;
	}

	.QuickForm label {
		align-items: center;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 11px;
		gap: 4px;
		white-space: nowrap;
	}

	.NotesCard span {
		color: var(--Ink3);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.NotesCard textarea {
		min-height: 120px;
		resize: vertical;
	}

	.TableWrap {
		padding: 0;
	}

	table {
		border-collapse: collapse;
		width: 100%;
	}

	th,
	td {
		border-bottom: 1px solid var(--RuleSoft);
		padding: 12px 16px;
		text-align: left;
		vertical-align: top;
	}

	th {
		background: var(--Surface);
		color: var(--Ink3);
		font-size: 10px;
		letter-spacing: 0.12em;
		position: sticky;
		text-transform: uppercase;
		top: 0;
	}

	.EditRow td {
		background: var(--Surface);
		padding-bottom: 16px;
		padding-top: 0;
	}

	.RowActions {
		align-items: center;
		display: flex;
		gap: 6px;
	}

	.RowActions > button {
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		color: var(--Ink2);
		display: grid;
		height: 30px;
		place-items: center;
		width: 30px;
	}

	.InlineEditForm,
	.CampaignEditForm {
		display: grid;
		gap: 8px;
	}

	.InlineEditForm {
		align-items: center;
		grid-template-columns: minmax(160px, 1fr) 86px minmax(160px, 1fr) 70px 110px repeat(3, auto) auto;
	}

	.InlineEditForm label {
		align-items: center;
		color: var(--Ink2);
		display: inline-flex;
		font-size: 11px;
		gap: 4px;
	}

	.Hook {
		color: var(--Ink2);
		font-family: 'Fraunces', serif;
		font-style: italic;
	}

	.PrimaryButton {
		align-items: center;
		background: var(--Green);
		border-color: var(--Green);
		color: white;
		display: inline-flex;
		gap: 7px;
		text-decoration: none;
	}

	.PrimaryButton:disabled {
		cursor: wait;
		opacity: 0.62;
	}

	.PageTitleRow {
		align-items: center;
		display: flex;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.PageTitleRow h1 {
		font-family: 'Fraunces', serif;
		font-size: 30px;
		font-weight: 400;
	}

	.CampaignGrid,
	.AccountGrid,
	.PreferenceGrid {
		display: grid;
		gap: 14px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.CampaignCard,
	.AccountCard,
	.PreferenceGrid label {
		padding: 18px;
	}

	.CampaignTop,
	.AccountTop {
		align-items: flex-start;
		display: flex;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.CampaignTop h2,
	.AccountTop h2 {
		font-family: 'Fraunces', serif;
		font-size: 20px;
		font-weight: 400;
	}

	.CampaignTop p,
	.AccountTop p {
		color: var(--Ink3);
		font-size: 12px;
	}

	.CampaignTop strong {
		color: var(--Green);
		font-family: 'Fraunces', serif;
		font-size: 24px;
		font-weight: 400;
	}

	.CampaignTop strong span {
		color: var(--Ink3);
		font-family: 'DM Sans', sans-serif;
		font-size: 11px;
	}

	.CampaignDetails {
		grid-template-columns: repeat(3, 1fr);
	}

	.Allowed {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 14px;
	}

	.Allowed span {
		background: var(--GreenSoft);
		color: var(--Green);
		margin: 0;
	}

	.CampaignEditForm {
		grid-template-columns: repeat(4, minmax(0, 1fr));
		margin-top: 14px;
	}

	.CampaignEditForm button {
		width: max-content;
	}

	.CampaignRules {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin-top: 14px;
	}

	.CampaignRules div {
		background: var(--RuleSoft);
		border-radius: 6px;
		padding: 9px;
	}

	.CampaignRules span {
		color: var(--Ink3);
		display: block;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		margin-bottom: 4px;
		text-transform: uppercase;
	}

	.CampaignRules p {
		color: var(--Ink2);
		font-size: 12px;
		line-height: 1.35;
	}

	.AddCard {
		background: transparent;
		border: 1px dashed var(--Rule);
		border-radius: 8px;
		color: var(--Ink3);
		min-height: 190px;
	}

	.MetricBand {
		grid-template-columns: repeat(4, 1fr);
		margin-top: 26px;
	}

	.MetricBand > div {
		padding: 16px;
	}

	.AccountGrid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin-bottom: 28px;
	}

	.ApiKeyPanel {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 16px;
		margin: 12px 0 28px;
		padding: 18px;
	}

	.SourceActionRow {
		align-items: center;
		display: flex;
		gap: 12px;
		justify-content: space-between;
		margin: 10px 0 12px;
	}

	.SourceActionRow div {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}

	.SourceSearch {
		align-items: center;
		background: var(--Page);
		border: 1px solid var(--Rule);
		border-radius: 6px;
		display: flex;
		gap: 7px;
		min-width: 230px;
		padding: 0 9px;
	}

	.SourceSearch input {
		background: transparent;
		border: 0;
		min-width: 0;
		padding: 6px 0;
	}

	.ImportBackupForm {
		display: flex;
	}

	.ImportBackupForm input {
		height: 1px;
		opacity: 0;
		pointer-events: none;
		position: absolute;
		width: 1px;
	}

	.SourceActionRow span {
		color: var(--Ink2);
		font-size: 12px;
	}

	.ApiKeyPanel h2 {
		font-family: 'Fraunces', serif;
		font-size: 22px;
		font-weight: 400;
		margin: 0 0 4px;
	}

	.ApiKeyPanel p {
		color: var(--Ink2);
		font-size: 12px;
	}

	.ApiKeyForm {
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.ApiKeyForm label {
		display: grid;
		gap: 6px;
	}

	.ApiKeyForm span,
	.CredentialList span {
		color: var(--Ink3);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.CredentialList {
		border-top: 1px solid var(--Rule);
		display: grid;
		gap: 1px;
		padding-top: 10px;
	}

	.CredentialList div {
		align-items: center;
		display: flex;
		gap: 10px;
		min-height: 32px;
	}

	.CredentialList strong {
		color: var(--Ink3);
		font-size: 12px;
		font-weight: 500;
		margin-left: auto;
	}

	.CredentialList strong.Configured {
		color: var(--Green);
	}

	.CredentialList form {
		display: flex;
	}

	.CredentialList button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		padding: 0;
	}

	.CredentialList button:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.AccountCard.Connected {
		border-color: #b0d0bc;
	}

	.EmptyState {
		align-items: center;
		background: var(--Surface);
		border: 1px dashed var(--Rule);
		border-radius: 8px;
		color: var(--Ink3);
		display: flex;
		gap: 8px;
		min-height: 120px;
		padding: 18px;
	}

	.LeadGrid > .EmptyState {
		grid-column: 1 / -1;
	}

	.EmptyState.InlineEmpty {
		border-left: 0;
		border-radius: 0;
		border-right: 0;
		min-height: 92px;
	}

	.EmptyState.MiniEmpty {
		background: var(--Page);
		min-height: 70px;
	}

	.InlineDelete {
		margin-top: 12px;
	}

	.InlineDelete.HeaderDelete {
		margin-left: auto;
		margin-top: 0;
	}

	.InlineDelete.TableDelete {
		margin-top: 0;
	}

	.InlineDelete button {
		background: transparent;
		border: 0;
		color: var(--Ink3);
		font-size: 11px;
		padding: 0;
	}

	.InlineDelete button:hover {
		color: #8c2a1e;
	}

	.AccountIcon {
		align-items: center;
		background: var(--GreenSoft);
		border-radius: 10px;
		color: var(--Green);
		display: grid;
		font-size: 20px;
		height: 40px;
		place-items: center;
		width: 40px;
	}

	.AccountTop {
		justify-content: flex-start;
		gap: 12px;
	}

	.AccountStats {
		grid-template-columns: repeat(3, 1fr);
		margin-bottom: 12px;
	}

	.ConnectedText {
		background: var(--GreenSoft);
		border-color: #b0d0bc;
		color: var(--Green);
		display: inline-block;
	}

	.PreferenceGrid {
		grid-template-columns: repeat(3, 1fr);
	}

	.SyncList {
		background: var(--Surface);
		border: 1px solid var(--Rule);
		border-radius: 8px;
		display: grid;
		gap: 1px;
		margin-bottom: 26px;
		overflow: hidden;
	}

	.SyncList div {
		background: var(--Page);
		display: flex;
		justify-content: space-between;
		padding: 11px 14px;
	}

	.SyncList span {
		color: var(--Ink2);
		font-size: 12px;
	}

	.PreferenceGrid label {
		display: grid;
		gap: 10px;
	}

	.PreferenceGrid button {
		align-self: end;
		justify-content: center;
		min-height: 42px;
	}

	@media (max-width: 1100px) {
		.ContentPanes,
		.AccountGrid,
		.CampaignGrid,
		.ApiKeyForm,
		.PreferenceGrid {
			grid-template-columns: 1fr;
		}

		.RightPanel {
			display: none;
		}

		.LeadGrid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 760px) {
		.Sidebar {
			display: none;
		}

		.Topnav {
			overflow-x: auto;
		}

		.CreatorHeader,
		.Subheader {
			align-items: flex-start;
			flex-wrap: wrap;
		}

		.SearchWrap {
			min-width: 0;
			width: 100%;
		}

		.RowThumb {
			flex-basis: 72px;
		}

		.RowTriageActions {
			border-left: 0;
			border-top: 1px solid var(--RuleSoft);
			flex: 0 0 100%;
			order: 4;
		}

		.RowTriageActions button {
			flex: 1;
			min-height: 34px;
		}

		.CreatorStats,
		.MetricBand {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			width: 100%;
		}

		.QuickForm,
		.QuickForm.QueueForm,
		.QuickForm.CreatorEditForm,
		.InlineEditForm,
		.CampaignEditForm {
			grid-template-columns: 1fr;
		}
	}
</style>
