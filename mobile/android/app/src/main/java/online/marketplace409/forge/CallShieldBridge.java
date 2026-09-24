package online.marketplace409.forge;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.CallLog;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;


import java.util.HashMap;
import java.util.Map;

/**
 * CallShieldBridge — the ONLY native code in Slice A.
 *
 * The browser can never read the Android call log, so this plugin exists for
 * exactly one OS API: CallLog.Calls. Everything else (normalizing, hashing,
 * staging, case association) happens in the web app through the normal API
 * routes. No network, no storage, no recording in this slice.
 *
 * Permission UX: the web UI explains why the permission is needed BEFORE
 * invoking getCallRecords, and this plugin requests READ_CALL_LOG alone
 * (never bundled with other permissions).
 */
@CapacitorPlugin(
    name = "CallShieldBridge",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_CALL_LOG },
            alias = "callLog"
        )
    }
)
public class CallShieldBridge extends Plugin {

    private static final int MAX_RECORDS = 2000;

    // Calls stashed while the permission dialog is up.
    private final Map<String, PluginCall> pendingCalls = new HashMap<>();

    @PluginMethod
    public void getCallRecords(PluginCall call) {
        int days = call.getInt("days", 30);
        if (days < 1) days = 1;
        if (days > 90) days = 90;

        if (getPermissionState("callLog") != PermissionState.GRANTED) {
            pendingCalls.put(call.getCallbackId(), call);
            requestPermissionForAlias("callLog", call, "handleCallLogPermission");
            return;
        }
        resolveCallLog(call, days);
    }

    @PermissionCallback
    private void handleCallLogPermission(PluginCall call) {
        PluginCall pending = pendingCalls.remove(call.getCallbackId());
        if (pending == null) {
            call.reject("Request expired. Try again.");
            return;
        }
        if (getPermissionState("callLog") == PermissionState.GRANTED) {
            int days = pending.getInt("days", 30);
            if (days < 1) days = 1;
            if (days > 90) days = 90;
            resolveCallLog(pending, days);
        } else {
            pending.reject(
                "Call-log access was denied. Automatic import needs the Phone permission " +
                "\"read call log\" — you can still log calls manually in Call Shield."
            );
        }
    }

    private void resolveCallLog(PluginCall call, int days) {
        if (getContext().checkSelfPermission(Manifest.permission.READ_CALL_LOG)
                != PackageManager.PERMISSION_GRANTED) {
            call.reject("Call-log permission is not granted.");
            return;
        }

        long sinceMillis = System.currentTimeMillis() - (long) days * 24L * 60L * 60L * 1000L;
        String[] projection = {
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.TYPE,
        };

        JSArray records = new JSArray();
        try (Cursor cursor = getContext().getContentResolver().query(
                CallLog.Calls.CONTENT_URI,
                projection,
                CallLog.Calls.DATE + " > ?",
                new String[] { String.valueOf(sinceMillis) },
                CallLog.Calls.DATE + " DESC")) {

            if (cursor == null) {
                call.reject("Could not read the call log on this device.");
                return;
            }

            int idIdx = cursor.getColumnIndex(CallLog.Calls._ID);
            int numberIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER);
            int nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME);
            int dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE);
            int durationIdx = cursor.getColumnIndex(CallLog.Calls.DURATION);
            int typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE);

            int count = 0;
            while (cursor.moveToNext() && count < MAX_RECORDS) {
                try {
                    JSObject record = new JSObject();
                    record.put("androidCallId", idIdx >= 0 ? cursor.getString(idIdx) : null);
                    record.put("phoneNumber", numberIdx >= 0 ? cursor.getString(numberIdx) : "");
                    record.put("callerName", nameIdx >= 0 ? cursor.getString(nameIdx) : null);
                    long dateMillis = dateIdx >= 0 ? cursor.getLong(dateIdx) : 0L;
                    String startedAt = null;
                    if (dateMillis > 0) {
                        java.text.SimpleDateFormat iso =
                            new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
                        iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                        startedAt = iso.format(new java.util.Date(dateMillis));
                    }
                    record.put("startedAt", startedAt);
                    record.put("durationSeconds", durationIdx >= 0 ? cursor.getLong(durationIdx) : 0L);
                    record.put("callType", mapCallType(typeIdx >= 0 ? cursor.getInt(typeIdx) : -1));
                    records.put(record);
                    count++;
                } catch (RuntimeException e) {
                    // Skip the malformed row; keep the rest.
                }
            }
        } catch (SecurityException e) {
            call.reject("Call-log access was revoked. Re-grant it in the import screen.");
            return;
        }

        JSObject result = new JSObject();
        result.put("records", records);
        try {
            result.put("deviceId", Settings.Secure.getString(
                getContext().getContentResolver(), Settings.Secure.ANDROID_ID));
        } catch (Exception e) {
            result.put("deviceId", "unknown");
        }
        call.resolve(result);
    }

    private String mapCallType(int type) {
        switch (type) {
            case CallLog.Calls.INCOMING_TYPE: return "incoming";
            case CallLog.Calls.OUTGOING_TYPE: return "outgoing";
            case CallLog.Calls.MISSED_TYPE: return "missed";
            case CallLog.Calls.REJECTED_TYPE: return "rejected";
            case CallLog.Calls.BLOCKED_TYPE: return "blocked";
            default: return "other";
        }
    }
}
