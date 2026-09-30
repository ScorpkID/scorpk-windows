import { supabase } from "../data/supabase";
import { ActionDispatcher } from "../domain/actionDispatcher";
import { AiInterpreter } from "../domain/aiInterpreter";
import { CommandProcessor } from "../domain/commandProcessor";
import { tauriBridge } from "../domain/nativeBridge";
import { browserNotify, TimerService } from "../domain/timerService";
import { openExternal } from "../util/openExternal";

/** Arma el procesador de órdenes con sus dependencias reales (la ventana principal y el overlay usan el mismo). */
export function createProcessor(): CommandProcessor {
  const timers = new TimerService({ notify: browserNotify });
  const dispatcher = new ActionDispatcher({ native: tauriBridge, timers, openUrl: openExternal });
  const ai = new AiInterpreter({
    accessToken: async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
  });
  return new CommandProcessor(ai, dispatcher);
}
