import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Request, Response } from 'express';
import { Permission } from 'shared/generated-types';

import { ConfigService } from '../../config/config.service';
import { Session } from '../../entity/session/session.entity';
import { AuthService } from '../../service/services/auth.service';

import { extractAuthToken } from '../common/extract-auth-token';
import { REQUEST_CONTEXT_KEY, RequestContextService } from '../common/request-context.service';
import { setAuthToken } from '../common/set-auth-token';
import { PERMISSIONS_METADATA_KEY } from '../decorators/allow.decorator';

/**
 * A guard which checks for the existence of a valid session token in the request and if found,
 * attaches the current User entity to the request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    strategy: any;

    constructor(
        private reflector: Reflector,
        private configService: ConfigService,
        private authService: AuthService,
        private requestContextService: RequestContextService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctx = GqlExecutionContext.create(context).getContext();
        const req: Request = ctx.req;
        const res: Response = ctx.res;
        const authDisabled = this.configService.authOptions.disableAuth;
        const permissions = this.reflector.get<Permission[]>(PERMISSIONS_METADATA_KEY, context.getHandler());
        const isPublic = !!permissions && permissions.includes(Permission.Public);
        const hasOwnerPermission = !!permissions && permissions.includes(Permission.Owner);
        const session = await this.getSession(req, res, hasOwnerPermission);
        const requestContext = await this.requestContextService.fromRequest(req, permissions, session);
        req[REQUEST_CONTEXT_KEY] = requestContext;

        if (authDisabled || !permissions || isPublic) {
            return true;
        } else {
            return requestContext.isAuthorized || requestContext.authorizedAsOwnerOnly;
        }
    }

    private async getSession(
        req: Request,
        res: Response,
        hasOwnerPermission: boolean,
    ): Promise<Session | undefined> {
        const authToken = extractAuthToken(req, this.configService.authOptions.tokenMethod);
        if (authToken) {
            return await this.authService.validateSession(authToken);
        } else if (hasOwnerPermission) {
            const session = await this.authService.createAnonymousSession();
            setAuthToken({
                authToken: session.token,
                rememberMe: true,
                authOptions: this.configService.authOptions,
                req,
                res,
            });
            return session;
        }
    }
}