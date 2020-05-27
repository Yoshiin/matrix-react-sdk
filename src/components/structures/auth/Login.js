/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2017 Vector Creations Ltd
Copyright 2018, 2019 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from 'react';
import createReactClass from 'create-react-class';
import PropTypes from 'prop-types';
import {_t, _td} from '../../../languageHandler';
import * as sdk from '../../../index';
import Login from '../../../Login';
import SdkConfig from '../../../SdkConfig';
import { messageForResourceLimitError } from '../../../utils/ErrorUtils';
import classNames from "classnames";
import AuthPage from "../../views/auth/AuthPage";
import Tchap from "../../../tchap/Tchap";

// Phases
// Show the appropriate login flow(s) for the server
const PHASE_LOGIN = 1;

// Enable phases for login
const PHASES_ENABLED = true;

// These are used in several places, and come from the js-sdk's autodiscovery
// stuff. We define them here so that they'll be picked up by i18n.
_td("Invalid homeserver discovery response");
_td("Failed to get autodiscovery configuration from server");
_td("Invalid base_url for m.homeserver");
_td("Homeserver URL does not appear to be a valid Matrix homeserver");
_td("Invalid identity server discovery response");
_td("Invalid base_url for m.identity_server");
_td("Identity server URL does not appear to be a valid identity server");
_td("General failure");

/**
 * A wire component which glues together login UI components and Login logic
 */
export default createReactClass({
    displayName: 'Login',

    propTypes: {
        // Called when the user has logged in. Params:
        // - The object returned by the login API
        // - The user's password, if applicable, (may be cached in memory for a
        //   short time so the user is not required to re-enter their password
        //   for operations like uploading cross-signing keys).
        onLoggedIn: PropTypes.func.isRequired,

        // If true, the component will consider itself busy.
        busy: PropTypes.bool,

        // Secondary HS which we try to log into if the user is using
        // the default HS but login fails. Useful for migrating to a
        // different homeserver without confusing users.
        fallbackHsUrl: PropTypes.string,

        defaultDeviceDisplayName: PropTypes.string,

        // login shouldn't know or care how registration, password recovery,
        // etc is done.
        onRegisterClick: PropTypes.func.isRequired,
        onForgotPasswordClick: PropTypes.func,
        onServerConfigChange: PropTypes.func.isRequired,
    },

    getInitialState: function() {
        return {
            busy: false,
            errorText: null,
            loginIncorrect: false,
            canTryLogin: true, // can we attempt to log in or are there validation errors?

            // used for preserving form values when changing homeserver
            username: "",

            // Phase of the overall login dialog.
            phase: PHASE_LOGIN,
            // The current login flow, such as password, SSO, etc.
            currentFlow: null, // we need to load the flows from the server

            // We perform liveliness checks later, but for now suppress the errors.
            // We also track the server dead errors independently of the regular errors so
            // that we can render it differently, and override any other error the user may
            // be seeing.
            serverIsAlive: true,
            serverErrorIsFatal: false,
            serverDeadError: "",
        };
    },

    componentWillMount: function() {
        this._unmounted = false;

        // map from login step type to a function which will render a control
        // letting you do that login type
        this._stepRendererMap = {
            'm.login.password': this._renderPasswordStep,
        };

        this._initLoginLogic();
    },

    componentWillUnmount: function() {
        this._unmounted = true;
    },

    componentWillReceiveProps(newProps) {
        if (newProps.serverConfig.hsUrl === this.props.serverConfig.hsUrl &&
            newProps.serverConfig.isUrl === this.props.serverConfig.isUrl) return;

        // Ensure that we end up actually logging in to the right place
        this._initLoginLogic(newProps.serverConfig.hsUrl, newProps.serverConfig.isUrl);
    },

    onPasswordLoginError: function(errorText) {
        this.setState({
            errorText,
            loginIncorrect: Boolean(errorText),
        });
    },

    isBusy: function() {
        return this.state.busy || this.props.busy;
    },

    onPasswordLogin: async function(username, phoneCountry, phoneNumber, password) {
        this.setState({
            busy: true,
            errorText: null,
            loginIncorrect: false,
        });

        await Tchap.discoverPlatform(username).then(hs => {
            this._initLoginLogic(hs, hs);
        });

        this._loginLogic.loginViaPassword(
            username, phoneCountry, phoneNumber, password,
        ).then((data) => {
            this.setState({serverIsAlive: true}); // it must be, we logged in.
            this.props.onLoggedIn(data, password);
        }, (error) => {
            if (this._unmounted) {
                return;
            }
            let errorText;

            // Some error strings only apply for logging in
            const usingEmail = username.indexOf("@") > 0;
            if (error.httpStatus === 400 && usingEmail) {
                errorText = _t('This homeserver does not support login using email address.');
            } else if (error.errcode === 'M_RESOURCE_LIMIT_EXCEEDED') {
                const errorTop = messageForResourceLimitError(
                    error.data.limit_type,
                    error.data.admin_contact, {
                    'monthly_active_user': _td(
                        "This homeserver has hit its Monthly Active User limit.",
                    ),
                    '': _td(
                        "This homeserver has exceeded one of its resource limits.",
                    ),
                });
                const errorDetail = messageForResourceLimitError(
                    error.data.limit_type,
                    error.data.admin_contact, {
                    '': _td(
                        "Please <a>contact your service administrator</a> to continue using this service.",
                    ),
                });
                errorText = (
                    <div>
                        <div>{errorTop}</div>
                        <div className="mx_Login_smallError">{errorDetail}</div>
                    </div>
                );
            } else if (error.httpStatus === 401 || error.httpStatus === 403) {
                if (error.errcode === 'M_USER_DEACTIVATED') {
                    errorText = _t('This account has been deactivated.');
                } else {
                    errorText = _t('Incorrect username and/or password.');
                }
            } else {
                // other errors, not specific to doing a password login
                errorText = this._errorTextFromError(error);
            }

            this.setState({
                errorText: errorText,
                // 401 would be the sensible status code for 'incorrect password'
                // but the login API gives a 403 https://matrix.org/jira/browse/SYN-744
                // mentions this (although the bug is for UI auth which is not this)
                // We treat both as an incorrect password
                loginIncorrect: error.httpStatus === 401 || error.httpStatus === 403,
            });
        }).finally(() => {
            if (this._unmounted) {
                return;
            }
            this.setState({
                busy: false,
            });
        });
    },

    onUsernameChanged: function(username) {
        this.setState({ username: username });
    },

    onUsernameBlur: async function(username) {
        this.setState({
            username: username,
            errorText: null,
            canTryLogin: true,
        });
    },

    onRegisterClick: function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        this.props.onRegisterClick();
    },

    _initLoginLogic: async function(hsUrl, isUrl) {
        hsUrl = hsUrl || this.props.serverConfig.hsUrl;
        isUrl = isUrl || this.props.serverConfig.isUrl;

        let isDefaultServer = false;
        if (this.props.serverConfig.isDefault
            && hsUrl === this.props.serverConfig.hsUrl
            && isUrl === this.props.serverConfig.isUrl) {
            isDefaultServer = true;
        }

        const fallbackHsUrl = isDefaultServer ? this.props.fallbackHsUrl : null;

        const loginLogic = new Login(hsUrl, isUrl, fallbackHsUrl, {
            defaultDeviceDisplayName: this.props.defaultDeviceDisplayName,
        });
        this._loginLogic = loginLogic;

        this.setState({
            busy: true,
            currentFlow: null, // reset flow
            loginIncorrect: false,
        });

        loginLogic.getFlows().then((flows) => {
            // look for a flow where we understand all of the steps.
            for (let i = 0; i < flows.length; i++ ) {
                if (!this._isSupportedFlow(flows[i])) {
                    continue;
                }

                // we just pick the first flow where we support all the
                // steps. (we don't have a UI for multiple logins so let's skip
                // that for now).
                loginLogic.chooseFlow(i);
                this.setState({
                    currentFlow: this._getCurrentFlowStep(),
                });
                return;
            }
            // we got to the end of the list without finding a suitable
            // flow.
            this.setState({
                errorText: _t(
                    "This homeserver doesn't offer any login flows which are " +
                        "supported by this client.",
                ),
            });
        }, (err) => {
            this.setState({
                errorText: this._errorTextFromError(err),
                loginIncorrect: false,
                canTryLogin: false,
            });
        }).finally(() => {
            this.setState({
                busy: false,
            });
        });
    },

    _isSupportedFlow: function(flow) {
        // technically the flow can have multiple steps, but no one does this
        // for login and loginLogic doesn't support it so we can ignore it.
        if (!this._stepRendererMap[flow.type]) {
            console.log("Skipping flow", flow, "due to unsupported login type", flow.type);
            return false;
        }
        return true;
    },

    _getCurrentFlowStep: function() {
        return this._loginLogic ? this._loginLogic.getCurrentFlowStep() : null;
    },

    _errorTextFromError(err) {
        let errCode = err.errcode;
        if (!errCode && err.httpStatus) {
            errCode = "HTTP " + err.httpStatus;
        }

        let errorText = _t("Error: Problem communicating with the given homeserver.") +
                (errCode ? " (" + errCode + ")" : "");

        if (err.cors === 'rejected') {
            if (window.location.protocol === 'https:' &&
                (this.props.serverConfig.hsUrl.startsWith("http:") ||
                 !this.props.serverConfig.hsUrl.startsWith("http"))
            ) {
                errorText = <span>
                    { _t("Can't connect to homeserver via HTTP when an HTTPS URL is in your browser bar. " +
                        "Either use HTTPS or <a>enable unsafe scripts</a>.", {},
                        {
                            'a': (sub) => {
                                return <a target="_blank" rel="noreferrer noopener"
                                    href="https://www.google.com/search?&q=enable%20unsafe%20scripts"
                                >
                                    { sub }
                                </a>;
                            },
                        },
                    ) }
                </span>;
            } else {
                errorText = <span>
                    { _t("Can't connect to homeserver - please check your connectivity, ensure your " +
                        "<a>homeserver's SSL certificate</a> is trusted, and that a browser extension " +
                        "is not blocking requests.", {},
                        {
                            'a': (sub) =>
                                <a target="_blank" rel="noreferrer noopener" href={this.props.serverConfig.hsUrl}>
                                    { sub }
                                </a>,
                        },
                    ) }
                </span>;
            }
        }

        return errorText;
    },

    renderLoginComponentForStep() {
        if (PHASES_ENABLED && this.state.phase !== PHASE_LOGIN) {
            return null;
        }

        const step = this.state.currentFlow;

        if (!step) {
            return null;
        }

        const stepRenderer = this._stepRendererMap[step];

        if (stepRenderer) {
            return stepRenderer();
        }

        return null;
    },

    _renderPasswordStep: function() {
        const PasswordLogin = sdk.getComponent('auth.PasswordLogin');

        let onEditServerDetailsClick = null;
        // If custom URLs are allowed, wire up the server details edit link.
        if (PHASES_ENABLED && !SdkConfig.get()['disable_custom_urls']) {
            onEditServerDetailsClick = this.onEditServerDetailsClick;
        }

        return (
            <PasswordLogin
               onSubmit={this.onPasswordLogin}
               onError={this.onPasswordLoginError}
               onEditServerDetailsClick={onEditServerDetailsClick}
               initialUsername={this.state.username}
               onUsernameChanged={this.onUsernameChanged}
               onUsernameBlur={this.onUsernameBlur}
               onForgotPasswordClick={this.props.onForgotPasswordClick}
               loginIncorrect={this.state.loginIncorrect}
               serverConfig={this.props.serverConfig}
               disableSubmit={this.isBusy()}
            />
        );
    },

    render: function() {
        const Loader = sdk.getComponent("elements.Spinner");
        const AuthHeader = sdk.getComponent("auth.AuthHeader");
        const AuthBody = sdk.getComponent("auth.AuthBody");
        const loader = this.isBusy() ? <div className="mx_Login_loader"><Loader /></div> : null;

        const errorText = this.state.errorText;

        let errorTextSection;
        if (errorText) {
            errorTextSection = (
                <div className="mx_Login_error">
                    { errorText }
                </div>
            );
        }

        let serverDeadSection;
        if (!this.state.serverIsAlive) {
            const classes = classNames({
                "mx_Login_error": true,
                "mx_Login_serverError": true,
                "mx_Login_serverErrorNonFatal": !this.state.serverErrorIsFatal,
            });
            serverDeadSection = (
                <div className={classes}>
                    {this.state.serverDeadError}
                </div>
            );
        }

        return (
            <AuthPage>
                <AuthHeader />
                <AuthBody>
                    <h2>
                        {_t('Sign in')}
                        {loader}
                    </h2>
                    { errorTextSection }
                    { serverDeadSection }
                    { this.renderLoginComponentForStep() }
                    <a className="mx_AuthBody_changeFlow" onClick={this.onRegisterClick} href="#">
                        { _t('Create account') }
                    </a>
                </AuthBody>
            </AuthPage>
        );
    },
});
