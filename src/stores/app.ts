import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface Checkpoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
  checked: boolean;
  riskFlag?: string;
  note?: string;
  images?: string[];
}

export interface PatrolTask {
  id: string;
  title: string;
  section: string;
  patrolRange?: string;
  patrolDistance?: string;
  priority: string;
  planTime?: string;
  team?: string;
  teamCount?: number;
  teamAvatars?: string[];
  status: string;
  riskLevel: string;
  assignee?: string;
  startTime: string;
  endTime?: string;
  checkpoints: Checkpoint[];
}

export interface DamSection {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

export interface RiskAlert {
  id: string;
  type: string;
  level: string;
  location: string;
  lng: number;
  lat: number;
  desc: string;
  time: string;
  value?: number;
  unit?: string;
}

export interface TodoItem {
  id: string;
  content: string;
  type: string;
  done: boolean;
}

export const useAppStore = defineStore("app", () => {
  const currentDam = ref<DamSection>({
    id: "1",
    name: "江宁堤段 K12+400",
    lng: 114.315,
    lat: 30.607,
  });
  const damSections = ref<DamSection[]>([
    { id: "1", name: "江宁堤段 K12+400", lng: 114.315, lat: 30.607 },
    { id: "2", name: "江宁堤段 K18+200", lng: 114.35, lat: 30.58 },
    { id: "3", name: "江宁堤段 K15+800", lng: 114.29, lat: 30.62 },
  ]);

  const weather = ref({ icon: "☀️", desc: "晴", temp: 32 });
  const waterLevel = ref(21.35);
  const isWaterOverWarning = computed(() => waterLevel.value >= 23);

  const patrolTasks = ref<PatrolTask[]>([]);
  const riskAlerts = ref<RiskAlert[]>([]);
  const todoItems = ref<TodoItem[]>([
    { id: "t1", content: "PZ-12 渗流异常需核查", type: "risk", done: false },
    { id: "t2", content: "巡检二班交接登记", type: "shift", done: false },
    { id: "t3", content: "应急物资盘点检查", type: "supply", done: false },
  ]);

  const totalCheckpoints = computed(() =>
    patrolTasks.value.reduce((s, t) => s + t.checkpoints.length, 0),
  );
  const checkedCount = computed(() =>
    patrolTasks.value.reduce(
      (s, t) => s + t.checkpoints.filter((c) => c.checked).length,
      0,
    ),
  );
  const patrolProgress = computed(() =>
    totalCheckpoints.value
      ? Math.round((checkedCount.value / totalCheckpoints.value) * 100)
      : 0,
  );
  const undoneCount = computed(
    () => todoItems.value.filter((t) => !t.done).length,
  );

  const todayTask = computed(
    () => patrolTasks.value.find((t) => t.status !== "completed") || null,
  );

  const estimatedCompleteTime = computed(() => {
    const task = todayTask.value;
    if (!task?.planTime) return "--";
    const parts = task.planTime.split(" ");
    if (parts.length < 2) return "--";
    const datePart = parts[0].slice(5); // MM-DD
    const timePart = parts[1].split("-").pop() || ""; // HH:mm (end time)
    return `${datePart} ${timePart}`;
  });

  const riskStats = ref({
    fixedPoints: 12,
    pendingReview: 3,
    monitorAlerts: 2,
    historyRisks: 47,
  });

  function setPatrolTasks(list: PatrolTask[]) {
    patrolTasks.value = list;
  }
  function addRiskAlert(a: RiskAlert) {
    riskAlerts.value.push(a);
  }
  function switchDam(dam: DamSection) {
    currentDam.value = dam;
  }
  function toggleTodo(id: string) {
    const item = todoItems.value.find((t) => t.id === id);
    if (item) item.done = !item.done;
  }
  function updateCheckpoint(
    taskId: string,
    cpId: string,
    data: Partial<Checkpoint>,
  ) {
    const task = patrolTasks.value.find((t) => t.id === taskId);
    if (!task) return;
    const cp = task.checkpoints.find((c) => c.id === cpId);
    if (cp) Object.assign(cp, data);
  }

  return {
    currentDam,
    damSections,
    weather,
    waterLevel,
    isWaterOverWarning,
    patrolTasks,
    riskAlerts,
    todoItems,
    totalCheckpoints,
    checkedCount,
    patrolProgress,
    undoneCount,
    todayTask,
    estimatedCompleteTime,
    riskStats,
    setPatrolTasks,
    addRiskAlert,
    switchDam,
    toggleTodo,
    updateCheckpoint,
  };
});
