import { Controller, Get, Param, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  settingGlobalSchema,
  settingSchema,
  templateSchema,
  type SettingInput,
  type TemplateInput,
} from '@indotek/shared';
import { AccessService } from '../access/access.service';
import { CurrentUser, EDITOR_ROLES, PROJECT_SETTING_ROLES, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApiZodBody, ZBody } from '../common/zod';
import { SettingsService } from './settings.service';
import { TemplatesService } from './templates.service';

@ApiTags('settings')
@ApiCookieAuth()
@Controller()
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly templates: TemplatesService,
    private readonly access: AccessService,
  ) {}

  @Get('settings/global')
  getGlobal() {
    return this.settings.getGlobal();
  }

  /** Setting global hanya bisa diubah ADMIN; role lain memakai preview what-if di Rekap. */
  @Put('settings/global')
  @Roles('ADMIN')
  @ApiZodBody(settingGlobalSchema)
  updateGlobal(@CurrentUser() user: AuthUser, @ZBody(settingGlobalSchema) body: SettingInput) {
    return this.settings.updateGlobal(user.id, body);
  }

  @Get('projects/:projectId/settings')
  async getProject(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    await this.access.assertProject(user, projectId);
    return this.settings.getProject(projectId);
  }

  /** Setting khusus project: hanya ADMIN & DIREKTUR (PM read-only, memakai preview what-if di web). */
  @Put('projects/:projectId/settings')
  @Roles(...PROJECT_SETTING_ROLES)
  @ApiZodBody(settingSchema)
  async updateProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @ZBody(settingSchema) body: SettingInput,
  ) {
    await this.access.assertProject(user, projectId);
    return this.settings.updateProject(user.id, projectId, body);
  }

  @Get('templates/global')
  getGlobalTemplate() {
    return this.templates.get(null);
  }

  @Put('templates/global')
  @Roles('ADMIN')
  @ApiZodBody(templateSchema)
  updateGlobalTemplate(@CurrentUser() user: AuthUser, @ZBody(templateSchema) body: TemplateInput) {
    return this.templates.upsert(user.id, null, body);
  }

  @Get('projects/:projectId/template')
  async getProjectTemplate(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    await this.access.assertProject(user, projectId);
    return this.templates.get(projectId);
  }

  @Put('projects/:projectId/template')
  @Roles(...EDITOR_ROLES)
  @ApiZodBody(templateSchema)
  async updateProjectTemplate(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @ZBody(templateSchema) body: TemplateInput,
  ) {
    await this.access.assertProject(user, projectId);
    return this.templates.upsert(user.id, projectId, body);
  }
}
