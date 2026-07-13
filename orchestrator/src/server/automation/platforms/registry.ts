/**
 * Platform registry.
 *
 * Maps AutomationPlatform identifiers to their concrete adapter instances.
 * To add a new platform, implement PlatformAutomator and register it here.
 */

import type { AutomationPlatform } from "@shared/types";
import type { BasePlatformAdapter } from "./base";
import { DiceAdapter } from "./dice";
import { GreenhouseAdapter } from "./greenhouse";
import { IndeedAdapter } from "./indeed";
import { LeverAdapter } from "./lever";
import { LinkedInAdapter } from "./linkedin";
import { MonsterAdapter } from "./monster";
import { NaukriAdapter } from "./naukri";
import { WellfoundAdapter } from "./wellfound";
import { WorkdayAdapter } from "./workday";
import { ZipRecruiterAdapter } from "./ziprecruiter";

type AdapterConstructor = new () => BasePlatformAdapter;

const REGISTRY: Record<AutomationPlatform, AdapterConstructor> = {
  linkedin: LinkedInAdapter,
  naukri: NaukriAdapter,
  indeed: IndeedAdapter,
  wellfound: WellfoundAdapter,
  greenhouse: GreenhouseAdapter,
  lever: LeverAdapter,
  workday: WorkdayAdapter,
  dice: DiceAdapter,
  monster: MonsterAdapter,
  ziprecruiter: ZipRecruiterAdapter,
};

/**
 * Create a fresh adapter instance for the given platform.
 * Call `adapter.injectContext(ctx)` before running any workflow.
 */
export function createAdapter(
  platform: AutomationPlatform,
): BasePlatformAdapter {
  const Ctor = REGISTRY[platform];
  if (!Ctor) {
    throw new Error(
      `No automation adapter registered for platform: ${platform}`,
    );
  }
  return new Ctor();
}

export function supportedPlatforms(): AutomationPlatform[] {
  return Object.keys(REGISTRY) as AutomationPlatform[];
}
