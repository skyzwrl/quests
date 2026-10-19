import { QuestCatalog, QuestTracker, event, reach, sequence, talk } from "@skyzwrl/quests";

const Players = game.GetService("Players");
const DataStoreService = game.GetService("DataStoreService");
const ReplicatedStorage = game.GetService("ReplicatedStorage");

interface Reward {
	readonly coins?: number;
	readonly item?: string;
}

const catalog = new QuestCatalog<Reward>({
	quests: [
		{ id: "first-steps", objective: talk("Guide"), reward: { coins: 50 } },
		{
			id: "smith",
			requires: ["first-steps"],
			objective: sequence(talk("Blacksmith"), event("collect", 5, { item: "Iron" }), talk("Blacksmith")),
			reward: { item: "IronSword" },
		},
		{ id: "lookout", objective: reach(new Vector3(0, 480, 0), 25), reward: { coins: 200 }, autoClaim: true },
		{ id: "daily-hunt", repeats: "daily", objective: event("defeat", 15), reward: { coins: 100 } },
		{ id: "daily-fish", repeats: "daily", objective: event("fish", 10), reward: { coins: 80 } },
		{ id: "daily-ore", repeats: "daily", objective: event("mine", 30), reward: { coins: 120 } },
		{
			id: "weekly-colossal",
			repeats: "weekly",
			objective: event("defeat", 1, { enemy: "Colossal" }),
			reward: { item: "BossCrate" },
		},
	],
	achievements: [
		{
			id: "slayer",
			event: "defeat",
			tiers: [
				{ name: "Bronze", threshold: 100, reward: { coins: 500 } },
				{ name: "Silver", threshold: 1000, reward: { coins: 5000 } },
				{ name: "Gold", threshold: 10000, reward: { item: "GoldBadge" } },
			],
		},
	],
	rotation: { daily: 2 },
	streakGraceDays: 1,
});

const store = DataStoreService.GetDataStore("Quests");
const questUpdated = new Instance("RemoteEvent");
questUpdated.Name = "QuestUpdated";
questUpdated.Parent = ReplicatedStorage;

const trackers = new Map<Player, QuestTracker<Reward>>();

function give(player: Player, reward: Reward) {
	const coins = player.FindFirstChild("leaderstats")?.FindFirstChild("Coins") as IntValue | undefined;
	if (reward.coins !== undefined && coins) {
		coins.Value += reward.coins;
	}
	if (reward.item !== undefined) {
		player.SetAttribute(`Owns${reward.item}`, true);
	}
}

Players.PlayerAdded.Connect((player) => {
	const key = `player_${player.UserId}`;
	const [ok, saved] = pcall(() => store.GetAsync(key)[0]);
	if (!ok) {
		player.Kick("Couldn't load your quests, please rejoin.");
		return;
	}

	const result = QuestTracker.fromSave(catalog, saved, { grant: (reward) => give(player, reward) });
	if (!result.ok) {
		// never start fresh over data we couldn't read, that would wipe it on the next save
		player.Kick("Your quest data needs a look, please rejoin.");
		return;
	}

	const tracker = result.tracker;
	trackers.set(player, tracker);
	tracker.onQuestUpdated((id) => questUpdated.FireClient(player, id, tracker.getQuest(id)));

	const login = tracker.recordLogin();
	if (login.status === "Continued" || login.status === "Saved") {
		give(player, { coins: 25 * math.min(login.streak, 7) });
	}
	for (const id of tracker.getOffers("daily")) {
		tracker.accept(id);
	}
});

Players.PlayerRemoving.Connect((player) => {
	const tracker = trackers.get(player);
	trackers.delete(player);
	if (tracker) {
		pcall(() => store.SetAsync(`player_${player.UserId}`, tracker.save()));
	}
});

export function onNpcTalked(player: Player, npc: string) {
	trackers.get(player)?.track("talk", { npc });
}

export function onEnemyDefeated(player: Player, enemy: Model) {
	trackers.get(player)?.track("defeat", { enemy: enemy.Name });
}

// reach objectives only need a coarse check, a few times a second is plenty
task.spawn(() => {
	while (true) {
		task.wait(0.5);
		for (const [player, tracker] of trackers) {
			const root = player.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
			if (root) {
				tracker.reportPosition(root.Position);
			}
		}
	}
});
