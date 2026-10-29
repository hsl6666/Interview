import AccountMenu from "../../auth/AccountMenu";
import type { PropsWithChildren } from "react";
import { CheckCircleFilled } from "@ant-design/icons";

const steps = [
  { key: "basic", label: "基础信息" },
  { key: "written", label: "技术笔试" },
  { key: "oral", label: "AI 口试" },
  { key: "done", label: "完成" },
] as const;

type InterviewShellProps = PropsWithChildren<{
  current: "basic" | "written" | "oral" | "done";
  title: string;
  description: string;
  oralEnabled?: boolean;
}>;

export function InterviewShell({
  current,
  title,
  description,
  oralEnabled = true,
  children,
}: InterviewShellProps) {
  const visibleSteps = oralEnabled ? steps : steps.filter((step) => step.key !== "oral");
  const currentIndex = visibleSteps.findIndex((step) => step.key === current);

  return (
    <main className="min-h-screen bg-[#f6f5f0] text-stone-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex justify-end">
          <AccountMenu />
        </div>
        <header className="flex flex-col gap-5 border-b border-stone-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-800">
              AI Interview Operating Desk
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-stone-950">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">{description}</p>
          </div>
          <nav
            className={`grid gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm ${
              oralEnabled ? "grid-cols-4" : "grid-cols-3"
            }`}
          >
            {visibleSteps.map((step, index) => {
              const active = step.key === current;
              const complete = index < currentIndex;
              return (
                <div
                  key={step.key}
                  className={[
                    "flex min-w-[72px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition",
                    active ? "bg-emerald-900 text-white" : "text-stone-500",
                    complete ? "text-emerald-800" : "",
                  ].join(" ")}
                >
                  {complete ? <CheckCircleFilled /> : <span>{index + 1}</span>}
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
              );
            })}
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
