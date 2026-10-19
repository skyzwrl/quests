export type QuestStatus = "Active" | "Completed" | "Claimed";

export interface QuestState {
	status: QuestStatus;
	// day or week number the quest was taken in, 0 for quests that don't repeat
	period: number;
	readonly progress: number[];
}

export interface AchievementState {
	progress: number;
	// how many tiers are unlocked and rewarded, not an index
	tier: number;
}
