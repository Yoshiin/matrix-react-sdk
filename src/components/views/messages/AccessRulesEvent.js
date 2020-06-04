/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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
import PropTypes from 'prop-types';
import { _t } from '../../../languageHandler';

export default class AccessRulesEvent extends React.Component {
    render() {
        const {mxEvent} = this.props;

        let body = null;
        let classes = "mx_EventTile_bubble mx_accessRulesEvent mx_accessRulesEvent_icon";
        if (mxEvent.getContent().rule === "unrestricted") {
            body = <div className={classes}>
                <div>
                    <div className="mx_accessRulesEvent_title">{_t("Room open to external users")}</div>
                    <div className="mx_accessRulesEvent_subtitle">
                        {_t("Externals are allowed to join this room")}
                    </div>
                </div>
            </div>
        }

        return (body);
    }
}

AccessRulesEvent.propTypes = {
    /* the MatrixEvent to show */
    mxEvent: PropTypes.object.isRequired,
};
