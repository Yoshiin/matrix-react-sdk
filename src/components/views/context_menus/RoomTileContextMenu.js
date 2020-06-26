/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2017 Vector Creations Ltd
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2019 The Matrix.org Foundation C.I.C.

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
import createReactClass from 'create-react-class';
import classNames from 'classnames';
import * as sdk from '../../../index';
import { _t, _td } from '../../../languageHandler';
import {MatrixClientPeg} from '../../../MatrixClientPeg';
import dis from '../../../dispatcher/dispatcher';
import DMRoomMap from '../../../utils/DMRoomMap';
import * as Rooms from '../../../Rooms';
import * as RoomNotifs from '../../../RoomNotifs';
import Modal from '../../../Modal';
import RoomListActions from '../../../actions/RoomListActions';
import RoomViewStore from '../../../stores/RoomViewStore';
import {sleep} from "../../../utils/promise";
import {MenuItem, MenuItemCheckbox, MenuItemRadio} from "../../structures/ContextMenu";
import Tchap from "../../../tchap/Tchap";

const RoomTagOption = ({active, onClick, src, srcSet, label}) => {
    const classes = classNames('mx_RoomTileContextMenu_tag_field', {
        'mx_RoomTileContextMenu_tag_fieldSet': active,
        'mx_RoomTileContextMenu_tag_fieldDisabled': false,
    });

    return (
        <MenuItemCheckbox className={classes} onClick={onClick} active={active} label={label}>
            <img className="mx_RoomTileContextMenu_tag_icon" src={src} width="15" height="15" alt="" />
            <img className="mx_RoomTileContextMenu_tag_icon_set" src={srcSet} width="15" height="15" alt="" />
            { label }
        </MenuItemCheckbox>
    );
};

const NotifOption = ({active, onClick, src, label}) => {
    const classes = classNames('mx_RoomTileContextMenu_notif_field', {
        'mx_RoomTileContextMenu_notif_fieldSet': active,
    });

    return (
        <MenuItemRadio className={classes} onClick={onClick} active={active} label={label}>
            <img className="mx_RoomTileContextMenu_notif_activeIcon" src={require("../../../../res/img/notif-active.svg")} width="12" height="12" alt="" />
            <img className="mx_RoomTileContextMenu_notif_icon mx_filterFlipColor" src={src} width="16" height="12" alt="" />
            { label }
        </MenuItemRadio>
    );
};

export default createReactClass({
    displayName: 'RoomTileContextMenu',

    propTypes: {
        room: PropTypes.object.isRequired,
        /* callback called when the menu is dismissed */
        onFinished: PropTypes.func,
    },

    getInitialState() {
        const dmRoomMap = new DMRoomMap(MatrixClientPeg.get());
        return {
            roomNotifState: RoomNotifs.getRoomNotifsState(this.props.room.roomId),
            isFavourite: this.props.room.tags.hasOwnProperty("m.favourite"),
            isLowPriority: this.props.room.tags.hasOwnProperty("m.lowpriority"),
            isDirectMessage: Boolean(dmRoomMap.getUserIdForRoomId(this.props.room.roomId)),
        };
    },

    componentDidMount: function() {
        this._unmounted = false;
    },

    componentWillUnmount: function() {
        this._unmounted = true;
    },

    _toggleTag: function(tagNameOn, tagNameOff) {
        if (!MatrixClientPeg.get().isGuest()) {
            sleep(500).then(() => {
                dis.dispatch(RoomListActions.tagRoom(
                    MatrixClientPeg.get(),
                    this.props.room,
                    tagNameOff, tagNameOn,
                    undefined, 0,
                ), true);

                this.props.onFinished();
            });
        }
    },

    _onClickFavourite: function() {
        // Tag room as 'Favourite'
        if (!this.state.isFavourite && this.state.isLowPriority) {
            this.setState({
                isFavourite: true,
                isLowPriority: false,
            });
            this._toggleTag("m.favourite", "m.lowpriority");
        } else if (this.state.isFavourite) {
            this.setState({isFavourite: false});
            this._toggleTag(null, "m.favourite");
        } else if (!this.state.isFavourite) {
            this.setState({isFavourite: true});
            this._toggleTag("m.favourite");
        }
    },

    _onClickLeave: function() {
        const dmRoomMap = new DMRoomMap(MatrixClientPeg.get());
        const isDMRoom = Boolean(dmRoomMap.getUserIdForRoomId(this.props.room.roomId));
        const QuestionDialog = sdk.getComponent("dialogs.QuestionDialog");

        if (Tchap.isUserLastAdmin(this.props.room) && !isDMRoom) {
            Modal.createTrackedDialog('Last admin leave', '', QuestionDialog, {
                title: _t("You are the last administrator"),
                description: _t("Are you sure you want to leave the room? The room will no longer be administered, and you may not be able to join it again."),
                button: _t("Leave"),
                onFinished: (proceed) => {
                    if (proceed) {
                        // Leave room
                        dis.dispatch({
                            action: 'leave_room',
                            room_id: this.props.room.roomId,
                        });
                    }
                },
            });
        } else {
            // Leave room
            dis.dispatch({
                action: 'leave_room',
                room_id: this.props.room.roomId,
            });
        }

        // Close the context menu
        if (this.props.onFinished) {
            this.props.onFinished();
        }
    },

    _onClickReject: function() {
        dis.dispatch({
            action: 'reject_invite',
            room_id: this.props.room.roomId,
        });

        // Close the context menu
        if (this.props.onFinished) {
            this.props.onFinished();
        }
    },

    _onClickForget: function() {
        // FIXME: duplicated with RoomSettings (and dead code in RoomView)
        MatrixClientPeg.get().forget(this.props.room.roomId).then(() => {
            // Switch to another room view if we're currently viewing the
            // historical room
            if (RoomViewStore.getRoomId() === this.props.room.roomId) {
                dis.dispatch({ action: 'view_next_room' });
            }
        }, function(err) {
            const errCode = err.errcode || _td("unknown error code");
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            Modal.createTrackedDialog('Failed to forget room', '', ErrorDialog, {
                title: _t('Failed to forget room %(errCode)s', {errCode: errCode}),
                description: ((err && err.message) ? err.message : _t('Operation failed')),
            });
        });

        // Close the context menu
        if (this.props.onFinished) {
            this.props.onFinished();
        }
    },

    _saveNotifState: function(newState) {
        if (MatrixClientPeg.get().isGuest()) return;

        const oldState = this.state.roomNotifState;
        const roomId = this.props.room.roomId;

        this.setState({
            roomNotifState: newState,
        });
        RoomNotifs.setRoomNotifsState(roomId, newState).then(() => {
            // delay slightly so that the user can see their state change
            // before closing the menu
            return sleep(500).then(() => {
                if (this._unmounted) return;
                // Close the context menu
                if (this.props.onFinished) {
                    this.props.onFinished();
                }
            });
        }, (error) => {
            // TODO: some form of error notification to the user
            // to inform them that their state change failed.
            // For now we at least set the state back
            if (this._unmounted) return;
            this.setState({
                roomNotifState: oldState,
            });
        });
    },

    _onClickAlertMe: function() {
        this._saveNotifState(RoomNotifs.ALL_MESSAGES_LOUD);
    },

    _onClickAllNotifs: function() {
        this._saveNotifState(RoomNotifs.ALL_MESSAGES);
    },

    _onClickMentions: function() {
        this._saveNotifState(RoomNotifs.MENTIONS_ONLY);
    },

    _onClickMute: function() {
        this._saveNotifState(RoomNotifs.MUTE);
    },

    _renderNotifMenu: function() {
        return (
            <div className="mx_RoomTileContextMenu" role="group" aria-label={_t("Notification settings")}>
                <div className="mx_RoomTileContextMenu_notif_picker" role="presentation">
                    <img src={require("../../../../res/img/notif-slider.svg")} width="20" height="107" alt="" />
                </div>

                <NotifOption
                    active={this.state.roomNotifState === RoomNotifs.ALL_MESSAGES_LOUD}
                    label={_t('All messages (noisy)')}
                    onClick={this._onClickAlertMe}
                    src={require("../../../../res/img/icon-context-mute-off-copy.svg")}
                />
                <NotifOption
                    active={this.state.roomNotifState === RoomNotifs.ALL_MESSAGES}
                    label={_t('All messages')}
                    onClick={this._onClickAllNotifs}
                    src={require("../../../../res/img/icon-context-mute-off.svg")}
                />
                <NotifOption
                    active={this.state.roomNotifState === RoomNotifs.MENTIONS_ONLY}
                    label={_t('Mentions only')}
                    onClick={this._onClickMentions}
                    src={require("../../../../res/img/icon-context-mute-mentions.svg")}
                />
                <NotifOption
                    active={this.state.roomNotifState === RoomNotifs.MUTE}
                    label={_t('Mute')}
                    onClick={this._onClickMute}
                    src={require("../../../../res/img/icon-context-mute.svg")}
                />
            </div>
        );
    },

    _renderLeaveMenu: function(membership) {
        if (!membership) {
            return null;
        }

        let leaveClickHandler = null;
        let leaveText = null;

        switch (membership) {
            case "join":
                leaveClickHandler = this._onClickLeave;
                leaveText = _t('Leave');
                break;
            case "leave":
            case "ban":
                leaveClickHandler = this._onClickForget;
                leaveText = _t('Forget');
                break;
            case "invite":
                leaveClickHandler = this._onClickReject;
                leaveText = _t('Reject');
                break;
        }

        return (
            <div>
                <MenuItem className="mx_RoomTileContextMenu_leave" onClick={leaveClickHandler}>
                    <img className="mx_RoomTileContextMenu_tag_icon" src={require("../../../../res/img/icon_context_delete.svg")} width="15" height="15" alt="" />
                    { leaveText }
                </MenuItem>
            </div>
        );
    },

    _renderRoomTagMenu: function() {
        return (
            <div>
                <RoomTagOption
                    active={this.state.isFavourite}
                    label={_t('Favourite')}
                    onClick={this._onClickFavourite}
                    src={require("../../../../res/img/icon_context_fave.svg")}
                    srcSet={require("../../../../res/img/icon_context_fave_on.svg")}
                />
            </div>
        );
    },

    render: function() {
        const myMembership = this.props.room.getMyMembership();

        switch (myMembership) {
            case 'join':
                return <div>
                    { this._renderNotifMenu() }
                    <hr className="mx_RoomTileContextMenu_separator" role="separator" />
                    { this._renderLeaveMenu(myMembership) }
                    <hr className="mx_RoomTileContextMenu_separator" role="separator" />
                    { this._renderRoomTagMenu() }
                </div>;
            case 'invite':
                return <div>
                    { this._renderLeaveMenu(myMembership) }
                </div>;
            default:
                return <div>
                    { this._renderLeaveMenu(myMembership) }
                </div>;
        }
    },
});
