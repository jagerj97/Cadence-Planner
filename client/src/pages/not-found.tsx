import { Link } from "wouter";
import { CalendarX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex-1 grid place-items-center p-6">
      <div className="card-md max-w-sm w-full p-6 grid justify-items-center gap-2 text-center">
        <CalendarX className="h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">This page doesn't exist</h1>
        <Link href="/" className="text-sm font-medium text-primary hover:underline">Go to Today</Link>
      </div>
    </div>
  );
}
